# @ublitzjs/payload package for receiving request payloads

![µBlitz.js](https://github.com/ublitzjs/core/blob/main/logo.png)
This module provides you with efficient utilities to simplify accumulating payload and receive multipart requests (busboy under the hood). 


## parseFormDataBody 
This utility lets you parse multipart/form-data and application/x-www-form-urlencoded
```typescript
import {registerAbort} from "@ublitzjs/core"
import {parseFormDataBody} from "@ublitzjs/payload"
server.post("/", async (res, req)=>{
  registerAbort(res);
  var result = await parseFormDataBody(
    {
      res, CT: req.getHeader("content-type"), 
      outDir: "tmp",
      parseLimits: {
        //busboy limits. If exceeded - reverts all disk changes and return error message
        fileSize: 1024*1024
      }
    }, 
    // mode "memory" | "disk"
    "disk", 
    // whether to accept repeated files/fields
    false
  );
  if(!result.ok) {
    // all saved files get auto-deleted
    // errCode as "400" | "500" (if disk failed)   
    if(!res.aborted) return res.writeStatus(res.errCode).end(res.data) // as string, error message
  }
  console.log("Files data", result.data.files)
  console.log("Fields", result.data.fields)
  res.end("OK")
})
```


## accumulateBody
Manually writing "res.onData" handling annoys, that's why here is a solution.

```typescript
import {accumulateBody} from "@ublitzjs/payload"
import {registerAbort} from "@ublitzjs/core"
server.post("/", async (res, req)=>{
  var CL = Number(req.getHeader("content-length"))
  if(CL > yourMaxBody) return res.writeStatus("413").end("too large")
  var result = await accumulateBody(res, CL) //CL lets preallocate memory
  if(res.aborted) return;
  console.log("Got payload", result.toString())
})
```
