import { extendApp } from "@ublitzjs/core";
import { App, us_listen_socket_close, us_socket_local_port, type us_listen_socket } from "uWebSockets.js"
import { afterAll } from "vitest";
export async function setupServer() {
  var result = {
    server: extendApp(App()),
    port: 0,
  }
  var listenSocket: us_listen_socket
  afterAll(() => {
    us_listen_socket_close(listenSocket)
  })
  return new Promise<typeof result>((resolve) => {
  result.server.listen(0, (socket) => {
    if (!socket) throw new Error("NOT LISTENING")
    result.port = us_socket_local_port(socket);
    listenSocket = socket;
    resolve(result);
  })
})
}
var skipAll: boolean = false;
export function skipHelper(param: {no?: boolean} = {}) {
  return { skip: param.no ? false : skipAll }
}
