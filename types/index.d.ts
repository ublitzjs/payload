import type { HttpResponse } from "@ublitzjs/core";
import type { Limits } from "busboy";
type SimpleCT = "application/json" | "application/x-protobuf" | "text/plain";
// type formCT = "multipart/form-data" | "application/x-www-form-urlencoded";
interface TheBody<Ok extends boolean, Data> {
  ok: Ok;
  data: Data;
}
interface stdBody {
  res: HttpResponse;
  limit?: number;
}
export interface FileInfo {
  filename: string;
  mimeType: string;
  encoding: string;
}
type Files<T> = Record<string, FileInfo & T>;
type formData<T> = { fields: object; files: Files<T> };
type TextBody = TheBody<true, string>;
interface PBMessage {
  toJSON(): object;
  [k: string]: any;
}
interface PBType {
  decode(arr: Uint8Array, length?: number): PBMessage;
  [k: string]: any;
}
/**
 * paths of files returned are usually strings.
 */
export type FilesOnDisk = Files<{ path: string | undefined }>;
export type FilesInMemory = Files<{ contents: Buffer<ArrayBuffer> }>;
export type FileSchema<T> = Record<keyof T[keyof T], any>;
/**
 * it parses multipart OR x-www-form-urlencoded body with busboy.Option "save" is applicable only to files. If you use "save: 'disk'" option - you will get "path" of temporary (or whatever you will do with file) location. If "memory" - you will get "contents" field as Buffer
 */
export function parseFormDataBody<T extends "disk" | "memory">(opts: {
  res: HttpResponse & { paused?: boolean; ok?: boolean };
  CT: string;
  save: T;
  limits?: Limits;
  outDir?: string;
}): Promise<
  | TheBody<
      true,
      T extends "memory"
        ? formData<{ contents: Buffer<ArrayBuffer> }>
        : T extends "disk"
        ? formData<{ path: string | undefined }>
        : never
    >
  | TheBody<false, Error>
>;
/** it process the request body and, if specified, parses with given content-type. Currently supports: text/plain, application/json, application/x-protobuf (with second parameter - proto schema)*/
export function parseSimpleBody<
  C extends SimpleCT | undefined,
  T extends PBType | undefined
>(
  { res, limit, CT }: stdBody & { CT: C },
  schema?: T
): Promise<
  | TheBody<
      true,
      C extends "text/plain"
        ? TextBody
        : C extends "application/json"
        ? object
        : C extends undefined
        ? Buffer<ArrayBuffer>
        : T extends { new (t: any): infer U } & PBType
        ? U
        : never
    >
  | TheBody<false, { error: Error; payload: Buffer }>
>;
/** works just like basicParseSimpleBody, but uses parseFormDataBody (just additional checks of body and whether request was aborted*/
export function basicParseFormDataBody<T extends "disk" | "memory">(opts: {
  res: HttpResponse & { paused?: boolean; ok?: boolean };
  CT: string;
  save: T;
  limits?: Limits;
  outDir?: string;
}): Promise<
  T extends "memory"
    ? formData<{ contents: Buffer<ArrayBuffer> }>
    : T extends "disk"
    ? formData<{ path: string | undefined }>
    : never
>;
/**
 * this function ONLY uses parseSimpleBody, throws an error if body wasn't parsed, throws an error if request was aborted and returns body.data
 */
export function basicParseSimpleBody<
  C extends SimpleCT | undefined,
  T extends PBType | undefined
>(
  { res, limit, CT }: stdBody & { CT: C },
  schema?: T
): Promise<
  C extends "text/plain"
    ? TextBody
    : C extends "application/json"
    ? object
    : C extends undefined
    ? Buffer<ArrayBuffer>
    : T extends { new (t: any): infer U } & PBType
    ? U
    : never
>;
