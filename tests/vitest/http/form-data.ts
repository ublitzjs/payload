import type { ClientRequest } from "node:http";
import type { FileInMemory, FileOnDisk, parseFormDataBody } from "@ublitzjs/payload"
import type { Limits } from "busboy";
import { registerAbort, type HttpRequest, type HttpResponse } from "@ublitzjs/core";
import { expect } from "vitest";
import { readFileSync, rmSync } from "node:fs";

export default class {
  private result: string | undefined
  private req: undefined | ClientRequest
  constructor(req?: ClientRequest){
    if(req) {
      this.req = req;
      this.req.write("--BOUNDARY\r\n")
    } else {
      this.result = "--BOUNDARY\r\n"
    }
  }
  private write(data: string){
    if(this.req) this.req.write(data);
    else this.result += data
  }
  field(name: string, value: string){
    this.write(`Content-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n--BOUNDARY\r\n`)
  }
  fields_array(name: string, values: string[]){
    for (var field of values){
      this.field(name, field);
    }
  }
  file(name: string, file: {data: string, CT: string; name: string}){
    this.write(`Content-Disposition: form-data; name="${name}"; filename="${file.name}"\r\nContent-Type: ${file.CT}\r\n\r\n${file.data}\r\n--BOUNDARY\r\n`)
  }
  files_array(name: string, files: {data: string, CT: string; name: string}[]){
    for (var file of files){
      this.file(name, file);
    }
  }
  endForm() {
    this.result += "--BOUNDARY--\r\n"
  }
  retrieve(): string | undefined {
    return this.result
  }
  
  static headers = {"Content-Type": "multipart/form-data; boundary=BOUNDARY"}
}
export function setupHandler(parseBody: typeof parseFormDataBody) {
  return function createHandler<T extends "disk" | "memory", Dups extends boolean>(
    fields: Record<string, Dups extends true ? string[] : string>,
    files: Record<
      string,
      T extends "disk" ? (
        Dups extends true ? (FileOnDisk & { expectedContent: string })[] : FileOnDisk & { expectedContent: string }
      ) : (
        Dups extends true ? FileInMemory[] : FileInMemory
      )
    >,
    type: T,
    repeated: Dups,
    opts: { limits?: Limits, outDir?: string } = {}
  ) {
    return async (res: HttpResponse, req: HttpRequest) => {
      registerAbort(res)
      var result = await parseBody({
        res, CT: req.getHeader("content-type"), parseLimits: opts.limits,
        outDir: opts.outDir,
      }, type, repeated)
      if (!result.ok) {
        res.cork(() => {
          //@ts-ignore
          res.writeStatus(result.errCode).end(result.data)
        })
      } else {
        var key: any;
        try {
          expect(result.data.fields).toEqual(fields)
          function validateFile(file: FileOnDisk, i: number) {
            var path = file.path;
            delete file.path;
            var expectedFile = repeated ? (files as any)[key][i] : files[key]
            var content = expectedFile.expectedContent;
            delete expectedFile.expectedContent;
            expect(file).toEqual(expectedFile)
            expectedFile.expectedContent = content;
            if (path) {
              expect(
                readFileSync(path!, { encoding: "utf8" })
              ).toBe(content);
              rmSync(path)
            }
          }
          if (type == "disk") {
            expect(Object.keys(result.data.files)).toEqual(Object.keys(files))
            for (key in files) {
              if (repeated) {
                let i = 0;
                for (const array of result.data.files[key] as FileOnDisk[]) {
                  validateFile(array, i++);
                }
              } else {
                validateFile(result.data.files[key] as FileOnDisk, 0)
              }
            }
          } else expect(result.data.files).toEqual(files)
          if (!res.aborted) res.cork(() => res.endWithoutBody())
            /* v8 ignore start */
        } catch (err) {
          if (!res.aborted) res.close()
        }
            /* v8 ignore stop */
      }
    }
  }
}
