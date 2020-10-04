// Required imports
import { IExtrinsic } from './types';
import * as fs from 'fs';
import * as Ajv from 'ajv';

// --------------------------------------------------------------
// wait ms milliseconds
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// --------------------------------------------------------------
// get block timestamp
export function GetTime(extrinsics: IExtrinsic[]): number {
  if (extrinsics[0].method != 'timestamp.set')
    return 0;

  const d = new Date(Number(extrinsics[0].args[0]));
  return d.getTime();
}

// --------------------------------------------------------------
// bigint division with decimal result
export function Divide(a: bigint, b: bigint): number {
  const q = Number(BigInt(a) / BigInt(b));
  const r = Number(BigInt(a) % BigInt(b));
  return q + r / Number(b);
}

// --------------------------------------------------------------
// validates configFile according to the schema file
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ValidateConfigFile(config: any, schemaFile: string): any {
  const ajv = new Ajv({ allErrors: true });
  const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
  const validate = ajv.compile(schema);

  if (!validate(config))
    throw Error('Invalid structure of config.json: ' + ajv.errorsText(validate.errors));
  return config;
}

// --------------------------------------------------------------
// loads config.json and return config object
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function LoadConfigFile(): any {
  const configFile = './config/config.json';
  const configFile_tpl = './config/config_tpl.json'

  // first copy config from temlate, if not there
  if (!fs.existsSync(configFile))
    fs.copyFileSync(configFile_tpl, configFile);

  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  return ValidateConfigFile(config, './schema/config.schema.json');
}

