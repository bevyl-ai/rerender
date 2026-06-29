// remover cloud deploy — the whole hook, one command. Builds the worker image
// (linux/amd64), pushes it to ECR (creating the repo if needed), and deploys the
// CloudFormation stack (Lambda + S3). No SAM, no manual steps — just docker + the AWS
// CLI, which `remover cloud deploy` shells out to.
import { execFileSync, execSync } from 'node:child_process';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

export interface DeployOptions {
  /** project dir to bake into the image (must have src/index.ts) */
  project: string;
  stackName?: string;
  region?: string;
  repo?: string;
  memory?: number;
  /** false → reuse an already-built local tag (`localTag`) instead of building */
  build?: boolean;
  localTag?: string;
}

export interface DeployResult {
  functionName: string;
  bucketName: string;
  region: string;
  imageUri: string;
}

const out = (cmd: string): string => execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const run = (cmd: string): void => {
  execSync(cmd, { cwd: REPO_ROOT, stdio: 'inherit' });
};
const runFile = (file: string, args: string[]): void => {
  execFileSync(file, args, { cwd: REPO_ROOT, stdio: 'inherit' });
};

export async function deploy(opts: DeployOptions): Promise<DeployResult> {
  const region = opts.region ?? process.env.AWS_REGION ?? (out('aws configure get region') || 'us-east-1');
  const stack = opts.stackName ?? 'remover-cloud';
  const repo = opts.repo ?? 'remover-worker';
  const account = out('aws sts get-caller-identity --query Account --output text');
  const registry = `${account}.dkr.ecr.${region}.amazonaws.com`;
  const imageUri = `${registry}/${repo}:latest`;

  console.log(`• ECR repo ${repo} (${region})…`);
  try {
    out(`aws ecr describe-repositories --repository-names ${repo} --region ${region}`);
  } catch {
    run(`aws ecr create-repository --repository-name ${repo} --region ${region} --image-scanning-configuration scanOnPush=false`);
  }

  console.log('• docker login to ECR…');
  run(`aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${registry}`);

  if (opts.build === false) {
    runFile('docker', ['tag', opts.localTag ?? 'remover-worker:amd64', imageUri]);
  } else {
    // PROJECT must be relative to the build context (the repo root), not absolute.
    const projectArg = relative(REPO_ROOT, opts.project);
    if (projectArg.startsWith('..'))
      throw new Error(`project must live inside the remover repo for now (got ${opts.project}); copy it under templates/ or a subdir`);
    console.log(`• building worker image (linux/amd64 — chrome-headless-shell is x86_64 only), baking ${projectArg}…`);
    // --provenance=false: buildx otherwise emits an attestation manifest list that Lambda rejects.
    runFile('docker', [
      'build',
      '--platform',
      'linux/amd64',
      '--provenance=false',
      '-f',
      'cloud/Dockerfile',
      '--build-arg',
      `PROJECT=${projectArg}`,
      '-t',
      imageUri,
      '.',
    ]);
  }

  console.log('• pushing image to ECR…');
  runFile('docker', ['push', imageUri]);

  // A previous failed CREATE leaves the stack in a terminal state that can't be updated.
  try {
    const status = out(
      `aws cloudformation describe-stacks --region ${region} --stack-name ${stack} --query "Stacks[0].StackStatus" --output text`,
    );
    if (/ROLLBACK_COMPLETE|ROLLBACK_FAILED|CREATE_FAILED|DELETE_FAILED/.test(status)) {
      console.log(`• deleting un-updatable stack (${status})…`);
      run(`aws cloudformation delete-stack --region ${region} --stack-name ${stack}`);
      run(`aws cloudformation wait stack-delete-complete --region ${region} --stack-name ${stack}`);
    }
  } catch {
    /* stack doesn't exist yet — fine */
  }

  console.log('• deploying CloudFormation stack…');
  runFile('aws', [
    'cloudformation',
    'deploy',
    '--region',
    region,
    '--stack-name',
    stack,
    '--template-file',
    'cloud/template.yaml',
    '--parameter-overrides',
    `ImageUri=${imageUri}`,
    ...(opts.memory ? [`MemorySize=${opts.memory}`] : []),
    '--capabilities',
    'CAPABILITY_IAM',
  ]);

  const outputs = JSON.parse(
    out(`aws cloudformation describe-stacks --region ${region} --stack-name ${stack} --query "Stacks[0].Outputs" --output json`),
  ) as { OutputKey: string; OutputValue: string }[];
  const get = (k: string): string => outputs.find((o) => o.OutputKey === k)?.OutputValue ?? '';
  const functionName = get('FunctionName');

  // CloudFormation doesn't re-pull a :latest tag whose URI is unchanged, so an updated
  // image would be ignored. Force the function onto the just-pushed digest.
  console.log('• pointing function at the pushed image…');
  run(`aws lambda update-function-code --region ${region} --function-name ${functionName} --image-uri ${imageUri} > /dev/null`);
  run(`aws lambda wait function-updated-v2 --region ${region} --function-name ${functionName}`);

  return { functionName, bucketName: get('BucketName'), region, imageUri };
}
