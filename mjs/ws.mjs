var encoder = new TextEncoder(), decoder = new TextDecoder();
function preParseWSMessage(rawMessage){ 
    var view = new Uint8Array(rawMessage);
    var eventLength = view[0]
    if (eventLength>100) throw new Error("event size > 100 bytes")
    if (eventLength + 2 > rawMessage.byteLength) throw new Error("Malformed payload")
    return {
      event: decoder.decode(view.subarray(1, 1 + eventLength)),
      message: view.subarray(1 + eventLength)
    }
}
function encodeWSMessage(event, payload){
  var encodedEvent = encoder.encode(event)
  if(encodedEvent.length > 100) throw new Error("event size > 100 bytes")
  var totalLength = 1 + encodedEvent.length + payload.byteLength
  var message = new Uint8Array(totalLength);
  message[0] = encodedEvent.length;
  message.set(encodedEvent, 1);
  message.set(payload instanceof Uint8Array 
    ? payload : new Uint8Array(payload),
    1 + encodedEvent.length
  );
  return message;
}
export {preParseWSMessage, encodeWSMessage}

