// src/lib/response.ts
import { Response } from "express";
import { ValidationError } from "express-validator";

/**
 * Standard response envelope used across the API.
 * Frontend should map "status" to its own ViewState enum:
 *   - "loading"  -> loading
 *   - "error"    -> error
 *   - "success"  -> success
 *   - "no_data"  -> noData
 */

export type ResponseError = { field?: string; message: string };

export type Envelope = {
  status: "success" | "error" | "loading" | "no_data";
  code: number;
  message?: string;
  data?: any | null;
  meta?: any | null;
  errors?: ResponseError[] | null;
};

export type HttpStatus =
  | 200
  | 201
  | 202
  | 204
  | 400
  | 401
  | 403
  | 404
  | 409
  | 422
  | 500;

export enum ViewState {
  Loading = "loading",
  Error = "error",
  Success = "success",
  NoData = "no_data",
}

/** Low Level sender */
export function sendResponse(res: Response, envelope: Envelope) {
  // ensure JSON response and status code set from envelope.code
  return res.status(envelope.code).json(envelope);
}

/** helper */

// response success
export function success(
  res: Response,
  data: any | null,
  message = "OK",
  code: HttpStatus = 200,
  meta: any | null = null
) {
  return sendResponse(res, {
    status: "success",
    code,
    message,
    data,
    meta,
    errors: null,
  });
}

// response no data
export function noData(
  res: Response,
  message = "No Data",
  code: HttpStatus = 200
) {
  return sendResponse(res, {
    status: "no_data",
    code,
    message,
    data: null,
    meta: null,
    errors: null,
  });
}

// response error
export function error(
  res: Response,
  code: HttpStatus = 500,
  message = "server error",
  errors: ResponseError[] | null = null
) {
  return sendResponse(res, {
    status: "error",
    code,
    message,
    data: null,
    meta: null,
    errors,
  });
}

// response loading
export function loading(
  res: Response,
  data: any,
  message = "Processing",
  code: HttpStatus = 202
) {
  return sendResponse(res, {
    status: "loading",
    code,
    message,
    data,
    meta: null,
    errors: null,
  });
}

/**
 * Helpers to safely read fields from express-validator error objects.
 * express-validator's types are union-y in TS (ValidationError | AlternativeValidationError),
 * so we be defensive here.
 */
function extractFieldFromValidationError(e: unknown): string | undefined {
  const anyE = e as any;
  // common properties we might find: param, path, location
  if (typeof anyE === "object" && anyE !== null) {
    if (typeof anyE.param === "string") return anyE.param;
    if (typeof anyE.path === "string") return anyE.path;
    if (Array.isArray(anyE.path) && anyE.path.length) {
      // e.path might be ['body','user','email'] or similar
      return anyE.path.join(".");
    }
    if (typeof anyE.location === "string") return anyE.location;
  }
  return undefined;
}

function extractMessageFromValidationError(e: unknown): string {
  const anyE = e as any;
  if (!anyE) return "Invalid value";
  if (typeof anyE.msg === "string") return anyE.msg;
  if (typeof anyE.message === "string") return anyE.message;
  // fallback: try to stringify
  try {
    return JSON.stringify(anyE);
  } catch {
    return String(anyE);
  }
}

/**
 * map express-validator errors -> ResponseError[]
 *
 * Accepts the result of `validationResult(req).array()` or any array of errors.
 * Defensive: works even if types differ across express-validator versions.
 */
export function mapValidationErrors(errs: unknown[]): ResponseError[] {
  if (!Array.isArray(errs)) return [{ message: "Validation failed" }];

  return errs.map((e) => {
    const field = extractFieldFromValidationError(e);
    const message = extractMessageFromValidationError(e);
    return { field, message };
  });
}
