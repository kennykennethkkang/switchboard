/** paid-guard: which Bash and aws-core calls ask before running. */
import { it } from 'node:test'
import assert from 'node:assert/strict'
import { spendOf } from '../kit/mods/paid-guard/hooks/register'

const bash = (command: string) => spendOf('Bash', { command })?.key
const awsMcp = (cli_command: string) => spendOf('mcp__plugin_aws-core_aws-mcp__call_aws', { cli_command })?.key

it('asks for AWS changes, with global options before the service and the copy/remove/invoke verbs', () => {
  for (const c of [
    'aws ec2 run-instances --image-id x',
    'AWS_PROFILE=p aws ec2 run-instances',
    'aws --profile prod ec2 run-instances --image-id x',
    'aws --region us-east-1 ec2 terminate-instances --instance-ids i-1',
    'aws --profile=prod --region=x ec2 terminate-instances',
    'aws --no-cli-pager --profile prod s3 rm s3://b --recursive',
    'aws s3 rm s3://b --recursive',
    'aws s3 sync . s3://bucket',
    'aws s3 cp f s3://b/f',
    'aws s3 mb s3://b',
    'aws s3 rb s3://b',
    'aws lambda invoke --function-name f out.json',
    'aws ec2 --region us-east-1 run-instances',
    'aws --profile p --region r ec2 terminate-instances',
  ]) {
    assert.equal(bash(c), 'aws', c)
    assert.equal(awsMcp(c), 'aws', c)
  }
})

it('lets read-only AWS commands through', () => {
  for (const c of ['aws s3 ls', 'aws --profile prod s3 ls s3://b', 'aws sts get-caller-identity', 'aws --region x ec2 describe-instances', 'aws lambda list-functions', 'aws configure list', 'aws s3 ls --recursive copy', 'aws --debug --no-cli-pager s3 ls run']) {
    assert.equal(bash(c), undefined, c)
    assert.equal(awsMcp(c), undefined, c)
  }
})

it('stays fast on a hostile command line', () => {
  const t = Date.now()
  bash('aws ' + '--a b '.repeat(20000))
  assert.ok(Date.now() - t < 500)
})
