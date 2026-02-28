import {App} from "uWebSockets.js"
import {extendApp, registerAbort} from "@ublitzjs/core"
import {accumulateBody, parseFormDataBody} from "@ublitzjs/payload"
import {nanoid} from "nanoid"
import {mkdirSync, rm} from "node:fs"

var server = extendApp(App()) 
var outDir = "tmp/" + nanoid(7)  
mkdirSync(outDir)
server.post("/multipart-disk", async (res, req)=>{
  registerAbort(res)
  var result = await parseFormDataBody({
    CT: req.getHeader("content-type"), res, outDir,
    parseLimits: {fileSize: 1024*1024+1}
  }, "disk", false)
  if(!result.ok) {
    if(!res.aborted) res.cork(()=>res.writeStatus(result.errCode).end(result.data))
    return
  }
  var files = Object.values(result.data.files);
  files.forEach((file)=>rm(file.path,()=>{}))
  res.cork(()=>res.end('{"partsReceived": ' + (
    files.length + Object.keys(result.data.fields).length
  ) + '}'))
})
server.post("/multipart-memory", async (res, req)=>{
  registerAbort(res)
  var result = await parseFormDataBody({
    CT: req.getHeader("content-type"), res, outDir,
    parseLimits: {fileSize: 1024*1024+1}
  }, "memory", false)
  if(!result.ok) {
    console.log("err", result.errCode, result.data)
    if(!res.aborted) res.cork(()=>res.writeStatus(result.errCode).end(result.data))
    return
  }
  var files = Object.values(result.data.files);
  res.cork(()=>res.end('{"partsReceived": ' + (
    files.length + Object.keys(result.data.fields).length
  ) + '}'))
})
server.post("/upload", async (res, req)=>{
  registerAbort(res)
  var result = await accumulateBody(res, Number(req.getHeader("content-length")), false)
  res.cork(()=>res.end('{"receivedBytes": ' + result.byteLength + '}'))
})
server.listen(9001, (socket)=>{
  if(!socket) throw new Error("Didn't start")
})

