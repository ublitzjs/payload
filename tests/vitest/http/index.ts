import { registerAbort } from "@ublitzjs/core";
import { request } from "node:http";
import {expectType} from "tsd"
//import { setTimeout as awaitTimeout } from "node:timers/promises"
import { describe, expect, it } from "vitest";
import { mkdirSync, readdirSync, rmdirSync } from "node:fs";
import { nanoid } from "nanoid";
import { skipHelper, setupServer } from "../shared"
import MyFormData, { setupHandler } from "./form-data"
import type { FileOnDisk, FilesInMemory, FilesOnDisk } from "@ublitzjs/payload";
import { Dispatcher, request as fetch2, Agent, setGlobalDispatcher } from "undici"
import type { UrlObject } from "node:url";
// just borrowed from undici
//
setGlobalDispatcher(new Agent({
  pipelining: 0
}))

function fetchMetadata<TOpaque = null> (
  url: string | URL | UrlObject,
  options?: { dispatcher?: Dispatcher } & Omit<Dispatcher.RequestOptions<TOpaque>, 'origin' | 'path' | 'method'> & Partial<Pick<Dispatcher.RequestOptions, 'method'>>,
): Promise<Dispatcher.ResponseData<TOpaque>> {
  return fetch2(url, options).then(async (res)=>{await res.body.arrayBuffer(); return res})
}

var runningTsd: boolean = false;
export default async function(module: typeof import("@ublitzjs/payload")) {
  var formHandler = setupHandler(module.parseFormDataBody)
  var {server, port} = await setupServer();
  describe("index module testing", async () => {
    var genLink = (path: string) => "http://localhost:" + port + path;
    describe('parseFormDataBody', () => {
      describe('basic stuff', () => {
        server.post("/basic/CT", formHandler({}, {}, "memory", false, { limits: { fields: 0 } }))
        var link = genLink("/basic/CT")
        /* v8 ignore start */
        it("is type-safe", skipHelper(), ()=>{
          if(runningTsd) {
            server.post("/types", async (res, req)=>{
              registerAbort(res);
              var resultMemorySingular = await module.parseFormDataBody({
                res, CT:req.getHeader("content-type")
              }, "memory", false);
              if(resultMemorySingular.ok) {
                expectType<{
                  files: FilesInMemory<false>;
                  fields: Record<string, string>;
                }>(resultMemorySingular.data)
              } else {
                expectType<string>(resultMemorySingular.data)
                expectType<"400" | "500">(resultMemorySingular.errCode)
              }

              var resultMemoryRepeated = await module.parseFormDataBody({
                res, CT:req.getHeader("content-type")
              }, "memory", true);
              if (resultMemoryRepeated.ok) {
                expectType<{
                  files: FilesInMemory<true>;
                  fields: Record<string, string[]>;
                }>(resultMemoryRepeated.data)
              } else {
                expectType<string>(resultMemoryRepeated.data)
                expectType<"400" | "500">(resultMemoryRepeated.errCode)
              }


              var resultDiskSingular = await module.parseFormDataBody({
                res, CT:req.getHeader("content-type")
              }, "disk", false);
              if (resultDiskSingular.ok) {
                expectType<{
                  files: FilesOnDisk<false>;
                  fields: Record<string, string>;
                }>(resultDiskSingular.data)
              } else {
                expectType<string>(resultDiskSingular.data)
                expectType<"400" | "500">(resultDiskSingular.errCode)
              }

              var resultDiskRepeated = await module.parseFormDataBody({
                res, CT:req.getHeader("content-type")
              }, "disk", true);
              if (resultDiskRepeated.ok) {
                expectType<{
                  files: FilesOnDisk<true>;
                  fields: Record<string, string[]>;
                }>(resultDiskRepeated.data)
              } else {
                expectType<string>(resultDiskRepeated.data)
                expectType<"400" | "500">(resultDiskRepeated.errCode)
              }
            })
          }
        })
        /* v8 ignore stop */
        it('rejects wrong or invalid content-type', skipHelper(), async () => {
          var genData = (header: string) => ({ method: "POST", headers: { "content-type": header } })
          var response = await Promise.all([
            fetchMetadata(link, genData("text/plain")),
            fetchMetadata(link, genData("multipart/form-data")), // checks for boundary absence
          ])
          expect(response[0].statusCode).toBe(400)
          expect(response[1].statusCode).toBe(400)

        });
        it("applies limits to busboy", skipHelper(), async () => {
          server.post("/basic/limits", formHandler({ user: "USER" }, {}, "memory", false, { limits: { fields: 1 } }))
          var link = genLink("/basic/limits");
          var body = new FormData();
          body.set("user", "USER")
          body.set("user2", "USER")
          // test ordinary FormData
          var response = await fetch(link, {
            method: "POST", body
          })
          // just to let socket rest
          response.arrayBuffer()
          expect(response.status).toBe(400)
        })
      });
      describe('Memory mode', () => {
        it('parses only non-repeated parts', skipHelper(), async () => {
          server.post(
            "/files/memory/singular",
            formHandler({
              field1: "1", field2: "2"
            }, {
              txt: {
                contents: Buffer.from("CONTENTS"),
                encoding: "7bit",
                mimeType: "text/plain",
                filename: "my_txt.txt"
              },
              txt2: {
                contents: Buffer.from("CONTENTS"),
                encoding: "7bit",
                mimeType: "text/plain",
                filename: "my_txt.txt"
              }
            }, "memory", false)
          )
          async function request(code: number) {
            var response = await fetchMetadata(genLink("/files/memory/singular"), {
              method: "POST",
              body: multipart.retrieve(),
              headers: MyFormData.headers
            })
            expect(response.statusCode).toBe(code)
          }
          var multipart = new MyFormData();
          multipart.field("field1", "1")
          multipart.field("field2", "2")
          multipart.file("txt", { CT: "text/plain", data: "CONTENTS", name: "my_txt.txt" })
          multipart.file("txt2", { CT: "text/plain", data: "CONTENTS", name: "my_txt.txt" })
          multipart.endForm()
          await request(200);
          multipart = new MyFormData();
          multipart.fields_array("fields", ["1", "2"])
          multipart.endForm()
          await request(400); // if validation failed - request would have thrown an error, not return status
          multipart = new MyFormData();
          multipart.files_array("files", [{CT:"a",data:"a",name:"a"},{CT:"a",data:"a",name:"a"}])
          multipart.endForm()
          await request(400); // if validation failed - request would have thrown an error, not return status
        })
        it('parses repeated files to memory + fields', skipHelper(), async () => {
          server.post(
            "/files/memory/repeated",
            formHandler({
              field: ["1", "2"], field2: ["1", "2"]
            }, {
              txt: [{
                contents: Buffer.from("CONTENTS"),
                encoding: "7bit",
                mimeType: "text/plain",
                filename: "my_txt.txt"
              }, {
                contents: Buffer.from("CONTENTS"),
                encoding: "7bit",
                mimeType: "text/plain",
                filename: "my_txt.txt"
              }],
              txt2: [{
                contents: Buffer.from("CONTENTS"),
                encoding: "7bit",
                mimeType: "text/plain",
                filename: "my_txt.txt"
              }, {
                contents: Buffer.from("CONTENTS"),
                encoding: "7bit",
                mimeType: "text/plain",
                filename: "my_txt.txt"
              }]
            }, "memory", true)
          )
          var multipart = new MyFormData();
          multipart.fields_array("field", ["1", "2"])
          multipart.fields_array("field2", ["1", "2"])
          multipart.files_array("txt", [
            { CT: "text/plain", data: "CONTENTS", name: "my_txt.txt" },
            { CT: "text/plain", data: "CONTENTS", name: "my_txt.txt" }
          ])
          multipart.files_array("txt2", [
            { CT: "text/plain", data: "CONTENTS", name: "my_txt.txt" },
            { CT: "text/plain", data: "CONTENTS", name: "my_txt.txt" }
          ])
          multipart.endForm();
            const response = await fetchMetadata(genLink("/files/memory/repeated"), {
              method: "POST",
              body: multipart.retrieve(),
              headers: MyFormData.headers
            })
            expect(response.statusCode).toBe(200)
        })
        it("handles empty files", skipHelper(), async () => {
          server.post(
            "/files/memory/empty",
            formHandler({}, {
              empty: {
                filename: "emptyFile",
                contents: Buffer.from("asd"),
                encoding: "7bit",
                mimeType: "application/octet-stream",
              }
            }, "memory", false, {})
          );
          var multipart = new MyFormData();
          multipart.file("empty", { CT: "application/octet-stream", data: "asd", name: "emptyFile" })
          multipart.endForm();
          var result = await fetchMetadata(genLink("/files/memory/empty"), {
            headers: MyFormData.headers,
            method: "POST",
            body: multipart.retrieve(),
          })
          expect(result.statusCode).toBe(200)
        })
        it("successfully aborts request", skipHelper(), async () => {
          await new Promise<void>((resolve) => {
            server.post("/files/memory/abort", async (res, req) => {
              registerAbort(res)
              var result = await module.parseFormDataBody({
                CT: req.getHeader("content-type"),
                res
              }, "memory", false)
              expect(result.ok).toBe(false)
              if (!res.aborted) res.end("500")
              expect(res.aborted).toBe(true)
              resolve()
            })
            var aborter = new AbortController();
            var req = request({
              port,
              hostname: "localhost",
              path: "/files/memory/abort",
              method: "POST",
              signal: aborter.signal,
              headers: {
                ...MyFormData.headers,
                "transfer-encoding": "chunked"
              }
            /* v8 ignore start */
            }, () => { throw new Error("Should have aborted 'memory' multipart") })
            /* v8 ignore stop */
            var multipart = new MyFormData(req);
            multipart.file("txt", { CT: "text/plain", data: "data", name: "name" })
            multipart.file("new", { CT: "abcd", data: "DATA", name: "" })
            setTimeout(() => {
              aborter.abort();
            }, 100)
          })
        })
      });
      describe("Disk mode",  () => {
        it("writes singular files to an outdir without side-effects", skipHelper(), async () => {
          var outDir = "tmp/" + nanoid(10);
          mkdirSync(outDir)
          server.post(
            "/files/disk/singular",
            formHandler({
              field: "abc", field2: "abcd"
            }, {
              file: {
                encoding: "7bit",
                expectedContent: "hello",
                mimeType: "text/plain",
                size: 5,
                filename: "file!", // for security reasons filename is random when writing it to disk and has no connection the given filename
              },
              file2: {
                encoding: "7bit",
                expectedContent: "BLABLABLA",
                mimeType: "application/octet-stream",
                size: 9,
                filename: "SomeContent"
              }
            }, "disk", false, { outDir })
          )
          var multipart = new MyFormData();
          multipart.field("field", "abc");
          multipart.field("field2", "abcd")
          multipart.file("file", { CT: "text/plain", data: "hello", name: "file!" })
          multipart.file("file2", { CT: "application/octet-stream", data: "BLABLABLA", name: "SomeContent" })
          multipart.endForm();
          var response = await fetchMetadata(genLink("/files/disk/singular"), {
            method: "POST",
            headers: MyFormData.headers,
            body: multipart.retrieve()
          })
          expect(response.statusCode).toBe(200)
          expect(readdirSync(outDir).length).toBe(0)
          rmdirSync(outDir);
        })
        it("writes repeated files to an outdir without side-effects", skipHelper(), async () => {
          var outDir = "tmp/" + nanoid(10);
          mkdirSync(outDir)
          server.post(
            "/files/disk/repeated",
            formHandler({
              fields: ["abc", "abcd"]
            }, {
              files: [{
                encoding: "7bit",
                expectedContent: "hello",
                mimeType: "text/plain",
                size: 5,
                filename: "file!", // for security reasons filename is random when writing it to disk and has no connection the given filename
              }, {
                encoding: "7bit",
                expectedContent: "BLABLABLA",
                mimeType: "application/octet-stream",
                size: 9,
                filename: "SomeContent"
              }]
            }, "disk", true, { outDir })
          )
          var multipart = new MyFormData();
          multipart.fields_array("fields", ["abc", "abcd"]);
          multipart.files_array(
            "files", [
            { CT: "text/plain", data: "hello", name: "file!" },
            { CT: "application/octet-stream", data: "BLABLABLA", name: "SomeContent" }
          ]
          )
          multipart.endForm();
          var response = await fetchMetadata(genLink("/files/disk/repeated"), {
            method: "POST",
            headers: MyFormData.headers,
            body: multipart.retrieve()
          })
          expect(response.statusCode).toBe(200)
          expect(readdirSync(outDir).length).toBe(0)
          rmdirSync(outDir);
        })
        it("handles cleanup after aborted requests", skipHelper(), async ()=>{
          var outDir = "tmp/" + nanoid(10);
          mkdirSync(outDir)

          var aborter = new AbortController();
          function doIt(type: "/singular" | "/repeated") {
            return new Promise<void>((resolve) => {
              server.post("/files/disk/abort" + type, async (res, req) => {
                registerAbort(res)
                var result = await module.parseFormDataBody({
                  CT: req.getHeader("content-type"),
                  res, outDir
                }, "disk", type === "/repeated")
                expect(result.ok).toBe(false)
                if (!res.aborted) res.end("500")
                expect(res.aborted).toBe(true)
                expect(readdirSync(outDir).length).toBe(0)
                resolve()
              })
              var req = request({
                port,
                hostname: "localhost",
                path: "/files/disk/abort" + type,
                method: "POST",
                signal: aborter.signal,
                headers: {
                  ...MyFormData.headers,
                  "transfer-encoding": "chunked"
                }
                /* v8 ignore start */
              }, () => { throw new Error("MUST NOT SEND RESPONSE") })
              /* v8 ignore stop */
              var multipart = new MyFormData(req);
              multipart.file("file", { CT: "application/octet-stream", data: "BLABLABLA", name: "SomeContent" })
              multipart.file("file2", { CT: "application/octet-stream", data: "BLABLABLA", name: "SomeContent2" })
              setTimeout(() => {
                aborter.abort();
              }, 100)
            })
          }
          await Promise.all([doIt("/singular"), doIt("/repeated")])
                rmdirSync(outDir)
        })
        it("doesn't create empty files", skipHelper(), async ()=>{
          var outDir = "tmp/" + nanoid(10);
          mkdirSync(outDir)
          server.post("/files/disk/empty", async (res, req)=>{
            registerAbort(res)
            var result = await module.parseFormDataBody({ res, CT: req.getHeader("content-type"), outDir },"disk", false)
            if (result.ok) {
              try {
                expect(result.data.files.file).toEqual({
                  filename: "empTY",
                  encoding: "7bit",
                  mimeType: "text/plain",
                  size: 0
                } as FileOnDisk)
              /* v8 ignore start */
              } catch (err) {
                console.error("ERROR", err)
              }
            } else console.error("ERROR", result.data)
            /* v8 ignore stop */
            if(!res.aborted) res.cork(()=>res.endWithoutBody())
          })
          var multipart = new MyFormData();
          multipart.file("file", { CT: "text/plain", data: "", name: "empTY" })
          multipart.endForm();
          var response = await fetchMetadata(genLink("/files/disk/empty"), {
            method: "POST",
            headers: MyFormData.headers,
            body: multipart.retrieve()
          })
          expect(response.statusCode).toBe(200)
          expect(readdirSync(outDir).length).toBe(0)
          rmdirSync(outDir);
        })
      })
    });

    describe("accumulateBody", ()=>{
        /* v8 ignore start */
      it("is type-safe", ()=>{
        if(runningTsd) {
          server.post("/body/types", async (res, req)=>{
            registerAbort(res)
            var result = await module.accumulateBody(res, Number(req.getHeader("content-length")), false)
            if(res.aborted) return;
            expectType<Buffer<ArrayBuffer>>(result)
            var result2 = await module.accumulateBody(res, Number(req.getHeader("content-length")), true)
            if(res.aborted) return;
            expectType<Buffer<SharedArrayBuffer>>(result2)
          })
        }
      })
        /* v8 ignore stop */
      it("accumulates larger bodies then 64KiB", async ()=>{
        var body = Buffer.allocUnsafeSlow(65*1024)
        server.post("/body/large", async (res, req)=>{
          registerAbort(res)
          var result = await module.accumulateBody(res, Number(req.getHeader("content-length")))
          expect(body.compare(result)).toBe(0)
          res.cork(()=>res.endWithoutBody())
        })
        await fetchMetadata(genLink("/body/large"), {method: "POST", body })
        
      })
    })
  });
}

////      describe('Backpressure handling', () => {});
////      describe('Edge cases', () => {
////        it('handles concurrent file uploads', async () => {});
////        it('handles large number of small files', async () => { //        });
////      });
