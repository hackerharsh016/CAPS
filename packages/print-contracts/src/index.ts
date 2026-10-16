import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsPlugin from 'ajv-formats';

const addFormats = ((addFormatsPlugin as unknown as { default?: (instance: Ajv2020) => void })
  .default ?? (addFormatsPlugin as unknown as (instance: Ajv2020) => void)) as (
  instance: Ajv2020
) => void;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Schema directory path
export const SCHEMA_DIR = path.resolve(__dirname, '../schema');
export const OPENAPI_DIR = path.resolve(__dirname, '../openapi');
export const EXAMPLES_DIR = path.resolve(__dirname, '../examples');

function loadJson<T = unknown>(relativeFilePath: string): T {
  const fullPath = path.resolve(__dirname, relativeFilePath);
  const content = fs.readFileSync(fullPath, 'utf-8');
  return JSON.parse(content) as T;
}

// Raw schema loaders
export const commonSchema = loadJson<Record<string, unknown>>('../schema/common.schema.json');
export const capabilitiesSchema = loadJson<Record<string, unknown>>(
  '../schema/capabilities.schema.json'
);
export const jobClaimRequestSchema = loadJson<Record<string, unknown>>(
  '../schema/job-claim-request.schema.json'
);
export const jobClaimResponseSchema = loadJson<Record<string, unknown>>(
  '../schema/job-claim-response.schema.json'
);
export const jobStatusUpdateRequestSchema = loadJson<Record<string, unknown>>(
  '../schema/job-status-update-request.schema.json'
);
export const jobStatusUpdateResponseSchema = loadJson<Record<string, unknown>>(
  '../schema/job-status-update-response.schema.json'
);
export const errorResponseSchema = loadJson<Record<string, unknown>>(
  '../schema/error-response.schema.json'
);
export const openApiV1 = loadJson<Record<string, unknown>>('../openapi/v1.json');

// Initialize AJV instance with Draft 2020-12 support and common schema preloaded
export function createValidator(): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false // Allow schema metadata keys like $defs
  });
  addFormats(ajv);
  ajv.addSchema(commonSchema, 'common.schema.json');
  return ajv;
}

export interface ContractValidators {
  validateCapabilities: ValidateFunction;
  validateJobClaimRequest: ValidateFunction;
  validateJobClaimResponse: ValidateFunction;
  validateJobStatusUpdateRequest: ValidateFunction;
  validateJobStatusUpdateResponse: ValidateFunction;
  validateErrorResponse: ValidateFunction;
}

export function buildValidators(ajv: Ajv2020 = createValidator()): ContractValidators {
  return {
    validateCapabilities: ajv.compile(capabilitiesSchema),
    validateJobClaimRequest: ajv.compile(jobClaimRequestSchema),
    validateJobClaimResponse: ajv.compile(jobClaimResponseSchema),
    validateJobStatusUpdateRequest: ajv.compile(jobStatusUpdateRequestSchema),
    validateJobStatusUpdateResponse: ajv.compile(jobStatusUpdateResponseSchema),
    validateErrorResponse: ajv.compile(errorResponseSchema)
  };
}

export const validators = buildValidators();

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: string[];
}

export function validateContract<T>(
  validateFn: ValidateFunction,
  payload: unknown
): ValidationResult<T> {
  const isValid = validateFn(payload);
  if (isValid) {
    return { success: true, data: payload as T };
  }
  const errors = (validateFn.errors ?? []).map(err => {
    const prop = err.instancePath ? ` at '${err.instancePath}'` : '';
    return `${err.message ?? 'Unknown validation error'}${prop}`;
  });
  return { success: false, errors };
}
