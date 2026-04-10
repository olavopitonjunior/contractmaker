import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import schema from '../schemas/dados_contrato.schema.json';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

export function validateDadosContrato(data: unknown): { valid: boolean; errors: string[] } {
  const valid = validate(data) as boolean;
  const errors = (validate.errors ?? []).map((err) => `${err.instancePath || '/'} ${err.message || ''}`.trim());
  return { valid, errors };
}
