export function preParseWSMessage(rawMessage: ArrayBuffer): {
    event: string;
    message: Uint8Array<ArrayBuffer>;
}
export function encodeWSMessage(event: string, payload: Uint8Array | ArrayBufferLike): Uint8Array
