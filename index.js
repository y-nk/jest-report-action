const { readFileSync } = require('fs')
const { join } = require('path')

const core = require('@actions/core')
const { exec } = require('@actions/exec')
const { context, getOctokit } = require('@actions/github')

const { createCoverageMap } = require('istanbul-lib-coverage')
const { markdownTable } = require('markdown-table')

const REPORT_FILE = join(process.cwd(), 'report.json')

const JEST_OPTIONS = ['--json', '--coverage', `--outputFile=${REPORT_FILE}`]

// ----------------

const main = async () => {
  const labels =
    context.payload &&
    context.payload.pull_request &&
    context.payload.pull_request.labels &&
    context.payload.pull_request.labels.map(({ name }) => name)

  const skip_on = core.getInput('skip_on')
  if (skip_on && labels.indexOf(skip_on) !== -1) return

  const cwd = process.cwd()
  const bin = core.getInput('jest', { required: false })

  const cmd = ['npm', 'npx'].some((e) => bin.startsWith(e))
    ? [bin, '--', ...JEST_OPTIONS]
    : [bin, ...JEST_OPTIONS]

  try {
    await exec(cmd.shift(), cmd, { cwd, silent: true })
  } catch (e) {
    core.setFailed(e)
  }

  // json report file
  const report = require(REPORT_FILE)

  if (!report.success) {
    const messages = report.testResults
      .filter((testResult) => testResult.status === 'failed')
      .map((testResult) => testResult.message)

    core.setFailed(['Some tests failed.', ...messages].join('\n\n'))
    return
  }

  // no comment if no pull request
  if (context.eventName !== 'pull_request') return

  const octokit = getOctokit(process.env.GITHUB_TOKEN)

  const map = createCoverageMap(report.coverageMap)
  const rows = [['Filename', 'Statements', 'Branches', 'Functions', 'Lines']]

  if (!Object.keys(map.data).length) {
    console.error('No entries found in coverage data')
    return
  }

  for (const [filename, data] of Object.entries(map.data)) {
    const { data: summary } = data.toSummary()

    rows.push([
      filename.replace(cwd, ''),
      `${summary.statements.pct}%`,
      `${summary.branches.pct}%`,
      `${summary.functions.pct}%`,
      `${summary.lines.pct}%`,
    ])
  }

  const scope = core.getInput('scope', { required: false })

  const body = [
    `:robot: **Code coverage** ${scope && `(${scope})`}`,
    markdownTable(rows, { align: ['l', 'r', 'r', 'r', 'r'] }),
  ].join('\n\n')

  const [owner, repo] = context.payload.repository.full_name.split('/')

  const payload = {
    owner,
    repo,
    issue_number: context.payload.pull_request.number,
    body,
  }

  try {
    await octokit.rest.issues.createComment(payload)
  } catch (err) {
    console.log(err)
  }
}

main()
