import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { request } from "undici";
import {
  App,
  type us_listen_socket,
  us_listen_socket_close,
  us_socket_local_port,
} from "uWebSockets.js";
import fs from "node:fs";
import {
  checkContentLength,
  registerAbort,
  type HttpRequest,
  type HttpResponse,
  type lowHeaders,
  type Server,
} from "@ublitzjs/core";
import { basicParseFormDataBody, basicParseSimpleBody } from "../mjs/index.mjs";
//#region variables
var port: number,
  socket: us_listen_socket,
  server = App() as Server,
  genLink = (link: string) => `http://localhost:${port}${link}`,
  parseFN = async (res: HttpResponse, req: HttpRequest) => {
    try {
      registerAbort(res);
      checkContentLength(res, req);
      var body = await basicParseSimpleBody({
        res,
        CT: req.getHeader<lowHeaders>("content-type"),
        limit: 10,
      });
      res.cork(() => {
        res.end(body);
      });
    } catch (error) {
      if (!res.aborted && !res.finished)
        res.cork(() => res.end((error as Error).message));
    }
  };
beforeAll(() => {
  if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
  server.listen(0, (token) => {
    socket = token;
    port = us_socket_local_port(token);
  });
});
afterAll(() => us_listen_socket_close(socket));
//#endregion

//#region routes
server.trace("/simple", parseFN).post("/multi-memory", async (res, req) => {
  try {
    registerAbort(res);
    checkContentLength(res, req);
    var body = await basicParseFormDataBody({
      res,
      CT: req.getHeader<lowHeaders>("content-type"),
      save: "memory",
    });
    if (!body) return;
    res.cork(() => {
      res.end(JSON.stringify(body));
    });
  } catch (error) {
    if (!res.aborted && !res.finished)
      res.cork(() => res.end((error as Error).message));
  }
});
//#endregion

describe("simple routes", { concurrent: true }, () => {
  it("Parses exactly up to limit", async () => {
    var message = "helloworld";
    var response = await request(genLink("/simple"), {
      method: "TRACE",
      body: message,
    });
    var body = await response.body.text();
    expect(body).toBe(message);
  });
  it("doesn't go beyond the limit", async () => {
    var response = await request(genLink("/simple"), {
      method: "TRACE",
      body: "hello world",
    });
    var body = await response.body.text();
    expect(body).toBe("Body is too large. Limit in bytes - 10");
  });
});
//describe("multipart", {concurrent:true},()=>{
//  it("parses as in-memory object", ()=>{
//   var data = new FormData()
//  data.set
// })
//})
