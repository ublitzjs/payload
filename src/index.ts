"use strict";
import { tmpdir } from "node:os"
import type { HttpResponse } from "@ublitzjs/core";
import busboy from "busboy";
import type { Limits } from "busboy"
import { nanoid } from "nanoid";
import { createWriteStream, type WriteStream } from "node:fs";
import { Buffer } from "node:buffer";
import { promises as fs } from "node:fs";
var bodyReceivalEndEvent = Symbol();
// type formCT = "multipart/form-data" | "application/x-www-form-urlencoded";
interface FileInfo {
  filename: string;
  mimeType: string;
  encoding:
  | "7bit"
  | "8bit"
  | "binary"
  | "base64"
  | "quoted-printable"
  | (string & {});
}
export interface FileOnDisk extends FileInfo {
  /**if no path, then there is no file created at all and size == 0*/
  path?: string
  size: number;
};
export interface FileInMemory extends FileInfo {
  contents: Buffer<ArrayBuffer>
}
type FilesType<T, Dup> = Record<string, Dup extends true ? T[] : T>;
// type of "files" object, returned by parseFormDataBody with disk mode
export type FilesOnDisk<Repeated extends boolean> = FilesType<FileOnDisk, Repeated>;
// type of "files" object, returned by parseFormDataBody with memory mode
export type FilesInMemory<Repeated extends boolean> = FilesType<FileInMemory, Repeated>;
/**
* This function asynchronously parses multipart requests until the end, so that any work considering unfinished request wouldn't need to be undone.
* This utility expects "unpaused" response object and doesn't set any additional properties on it.  
* When limits are exceeded - acts as like because of an error (as described below)
* @param limits - limits passed to "busboy"
* @doesn_not_throw if error occurs, it either deletes all files (see "save" param) or clears allocated memory. It returns string message about error instead of the files. "errCode" is a property, which is set in all handled bad scenarios (usually 400, but if disk mode fails - 500). Response won't be sent as well as status won't be set, however it will be paused with res.pause(). Also you have to check whether request wansn't aborted (if so - don't touch errCode. It has no value). 
* @validation while streaming it is not supported. Do it manually afterwards.
* @example
* import {registerAbort} from "@ublitzjs/core"
* import {parseFormDataBody} from "@ublitzjs/payload"
* server.post("/", async (res, req)=>{
*   registerAbort(res);
*   var result = await parseFormDataBody(
*     {
*       res, CT: req.getHeader("content-type"), 
*       outDir: "tmp",
*       parseLimits: {
*         //busboy limits. If exceeded - reverts all disk changes and return error message
*         fileSize: 1024*1024
*       }
*     }, 
*     // mode "memory" | "disk"
*     "disk", 
*     // whether to accept repeated files/fields
*     false
*   );
*   if(!result.ok) {
*     // all saved files get auto-deleted
*     // errCode as "400" | "500" (if disk failed)   
*     if(!res.aborted) return res.writeStatus(res.errCode).end(res.data) // as string, error message
*   }
*   console.log("Files data", result.data.files)
*   console.log("Fields", result.data.fields)
*   res.end("OK")
* })
*
* */
export async function parseFormDataBody<T extends "memory" | "disk", Repeated extends boolean>(params: {
  /**it starts with
  * 1) application/x-www-form-urlencoded
  * 2) multipart/form-data
  * OR whatever "busboy" supports*/
  CT: string,
  res: HttpResponse,
  /**limits that "busboy" supports*/
  parseLimits?: Limits,
} & (T extends "disk" ? {
  /** @default (await import("node:os")).tmpdir()*/
  outDir?:string
}:{}),
  /**
   * @disk all files get randomly generated name and are written to "ourDir" you pass (or tmpdir).
   * File paths are given as a return value. Path is "undefined" if file has size of 0 (that's why it is not saved on disk).
  * If any error happens - all files are deleted. 
  * @memory all files are saved as "Buffer".
  * If error, then they are just cleared
  * */
  save: T,
  repeatedParts: Repeated
): Promise<{
  ok: true,
  data: {
    files: T extends "memory" ? FilesInMemory<Repeated> : FilesOnDisk<Repeated>,
    fields: Record<string, Repeated extends true ? string[] : string>
  }
} | {
  ok: false,
  /**Error message*/
  data: string
  errCode: "400" | "500"
}> {
  var res = params.res;
  try {
    var parserStream = busboy({
      headers: { "content-type": params.CT },
      defParamCharset: "utf8",
      limits: params.parseLimits
    });
  } catch (err) {
    return { ok: false, data: (err as Error).message, errCode: "400" }
  }
  if((!params as any).outDir) (params as any).outDir = tmpdir() + "/" as any
  var files: T extends "memory" ? FilesInMemory<Repeated> : FilesOnDisk<Repeated> = {} as any // I can't prove it to ts
  var fields: Record<string, Repeated extends true ? string[] : string> = {}
  var diskWritePromises: Promise<void>[] = [];
  var lastError: string | null = null;
  var errCode: "500" | "400" = "400"
  var resShouldPauseStack: number = 0;
  var resIsPaused: boolean = false;
  var emergency: Promise<void[]> | true | undefined = undefined;
  function emitEmergency() {
    if (emergency) return;
    emergency = true;
    if (!res.aborted && !resShouldPauseStack) res.pause();
    if (!parserStream.writableEnded || !parserStream.errored) parserStream.destroy();
    if (save === "disk") {
      var massFileDestruction: Promise<void>[] = []
      if (repeatedParts) {
        for (let fileName in (files as FilesOnDisk<true>)) {
          const currentFiles = (files as FilesOnDisk<true>)[fileName]!;
          for (let file of currentFiles) {
            if (file.path) massFileDestruction.push(fs.rm(file.path))
          }
        }
      } else {
        for (let fileName in (files as FilesOnDisk<false>)) {
          const file = (files as FilesOnDisk<false>)[fileName]!;
          if (file.path) massFileDestruction.push(fs.rm(file.path))
        }
      }
      emergency = Promise.all(massFileDestruction)
    }
    res.emitter.emit(bodyReceivalEndEvent);
  }
  function emptyCB(){}
  parserStream
    .on("file",
      save == "memory"
        ? function putToMemory(name, readable, metadata): any {
          var contents: Buffer[] = []
          var size = 0;
          var file = metadata as FileInMemory;
          if (repeatedParts) {
            ((files as any)[name] ??= []).push(file);
          } else if (name in files) {
            lastError ??= "File duplication"
            return res.emitter.emit(bodyReceivalEndEvent);
          } else (files as any)[name] = file;
          readable.on("data", (chunk: Buffer) => {
            contents.push(chunk);
            size += chunk.length;
            // on error is empty because it can happen only when destroying parserStream
          }).once("error",emptyCB).once("limit", ()=>{
            lastError ??= "File " + file.filename + " is too large";
            res.emitter.emit(bodyReceivalEndEvent)
          }).once("end", () => {
            file.contents = Buffer.concat(contents, size)
          })
        }
        : function putToDisk(name, readable, { filename, encoding, mimeType }): any {
          var writable: WriteStream;
          var file: FileOnDisk = { mimeType, encoding, filename } as any // size will come later
          if (repeatedParts) {
            ((files as any)[name] ??= []).push(file)
          } else if (name in files) {
            if (!lastError) lastError = "File duplicate"
            return res.emitter.emit(bodyReceivalEndEvent);
          } else files[name] = file as any;
          readable
            // create file only if it needs some contents
            .once("data", ()=>{ 
              writable = createWriteStream((params as any).outDir + nanoid(11));
              diskWritePromises.push(
                new Promise<void>((resolve) => {
                  writable
                    // as data flushed - file is usable
                    .once("finish", (): any => {
                      if (!readable.readableDidRead) {
                        file.size = 0
                      } else {
                        file.size = writable.bytesWritten;
                        file.path = writable.path as string;
                        if (lastError) { // includes "res.aborted"
                          fs.rm(writable.path).finally(resolve)
                        } else resolve()
                      }
                    })
                    .once("error", (err) => {
                      if (!lastError) { lastError = err.message; errCode = "500"; }
                      readable.destroy();
                      resolve()
                      if (!emergency) res.emitter.emit(bodyReceivalEndEvent);
                    });
                })
              )
            }).on("data", (chunk): any => {
              if(lastError) return readable.destroy();
              if (writable.write(chunk)) return;
              readable.pause();
              if (!parserStream.writableEnded && resShouldPauseStack++ === 0) { res.pause(); resIsPaused=true;}
              writable.once("drain", ()=>{
                readable.resume()
                if (--resShouldPauseStack === 0 && resIsPaused) {
                  res.resume(); resIsPaused=false
                }
              })
            }).once("error", emptyCB).once("limit", ()=>{
              lastError ??= "File " + file.filename + " is too large";
              res.emitter.emit(bodyReceivalEndEvent)
            }).once("end", ()=>{
              if(writable) {
                if(readable.isPaused()) { writable.emit("drain") }
                writable.end();
              }
              else file.size = 0
            })
        }
    )
    .on(
      "field",
      repeatedParts
        ? (fieldname, value) => {
          (fields as any)[fieldname] ??= [];
          (fields as any)[fieldname].push(value)
        }
        : (fieldname, value) => {
          if (fieldname in fields) {
            if (!lastError) lastError = "Field duplicate"
            res.emitter.emit(bodyReceivalEndEvent)
          } else (fields as any)[fieldname] = value
        }
    )
    .once("close", () => {
      if (save === "disk")
        Promise
          .all(diskWritePromises)
          // no need to handle "catch" as all those promises already do
          .finally(() => { res.emitter.emit(bodyReceivalEndEvent) })
      else 
        res.emitter.emit(bodyReceivalEndEvent)
    })
    .once("error", (err) => {
      if (!lastError) lastError = (err as Error).message;
      res.emitter.emit(bodyReceivalEndEvent)
    })
  function onLimitsExceeded() {
    lastError ??= "Too many parts in request"; res.emitter.emit(bodyReceivalEndEvent)
  }
  parserStream
    .once("fieldsLimit", onLimitsExceeded)
    .once("filesLimit", onLimitsExceeded)
    .once("partsLimit", onLimitsExceeded)
  function onAborted() {
    if(!lastError) { lastError = "aborted" }
    emitEmergency()
  }
  res.emitter.once("abort", onAborted);
  res.onData((ab, isLast) => {
    if (lastError) return;
    var copy = Buffer.allocUnsafe(ab.byteLength)
    copy.set(new Uint8Array(ab))
    parserStream.write(copy);
    if (isLast) { parserStream.end();}
  });
  // calling emitter.emit many times won't hurt, as listener is ONE and emitEmergency might be called IN ONE PLACE
  await new Promise((resolve) => res.emitter.once(bodyReceivalEndEvent, resolve));
  if(!res.aborted) res.emitter.off("abort", onAborted);
  if(lastError && !emergency) { emitEmergency(); }
  if(emergency && emergency !== true) await (emergency as Promise<void[]>);
  return !lastError 
    ? { ok: true, data: { fields: fields as any, files } }
    : { ok: false, data: lastError!, errCode: errCode! };
}
type AccumulatedBody<T extends boolean> =  Buffer<T extends true ? SharedArrayBuffer : ArrayBuffer>
/**
* This utility just accumulates body and verifies if it stays within the given limit.
* @param CL this is Content-Length to be compared against + acts as a preallocation amount.
* If not given by developer OR == 0 - constantly happen memory reallocations with Buffer.concat
* @param shared whether return Buffer of SharedArrayBuffer or simple ArrayBuffer. SharedArrayBuffer lets you pass data to a worker thread if work there is cpu intensive
* @returns if response was not aborted - full buffer, if was - empty Buffer
* @example
* import {accumulateBody} from "@ublitzjs/payload"
* import {registerAbort} from "@ublitzjs/core"
* server.post("/", async (res, req)=>{
*   var CL = Number(req.getHeader("content-length"))
*   if(CL > yourMaxBody) return res.writeStatus("413").end("too large")
*   var result = await accumulateBody(res, CL) //CL lets preallocate memory
    if(res.aborted) return;
    console.log("Got payload", result.toString())
* })
* */
export async function accumulateBody<T extends boolean = false>(
  res: HttpResponse,
  CL: number = 0,
  shared?: T 
): Promise<AccumulatedBody<T>> {
  var data: AccumulatedBody<T>
  var writtenBytes = 0;
  var write: (ab: ArrayBuffer)=>void = CL ? (ab)=>{
    data.set(new Uint8Array(ab), writtenBytes);
  } : (ab)=>{
    data = Buffer.concat([data, Buffer.from(ab)]) as AccumulatedBody<T>
  }
  data = (shared ? Buffer.from(new SharedArrayBuffer(CL)) : Buffer.allocUnsafe(CL)) as AccumulatedBody<T>
  res.onData((ab, isLast) => {
    write(ab);
    writtenBytes += ab.byteLength;
    if(isLast) res.emitter.emit(bodyReceivalEndEvent);
  });
  function onAborted(){
    data = Buffer.allocUnsafe(0) as AccumulatedBody<T>
    res.emitter.emit(bodyReceivalEndEvent);
  }
  res.emitter.once("abort", onAborted);
  await new Promise((resolve) => res.emitter.once(bodyReceivalEndEvent, resolve));
  if(!res.aborted) res.emitter.off("abort", onAborted);
  return data;
}

