const fs = require('fs');

const COMMENT_MARKER = '<!-- river-reviewer -->';
const MAX_COMMENT_LENGTH = 65000;

module.exports = async function postComment({ github, context, core }) {
  const outputPath = process.env.RIVER_REVIEWER_COMMENT_PATH;
  if (!outputPath || !fs.existsSync(outputPath)) {
    core.setFailed('River Reviewer output file not found; cannot post comment.');
    return;
  }

  let body = fs.readFileSync(outputPath, 'utf8').trim();
  if (!body.startsWith(COMMENT_MARKER)) {
    body = `${COMMENT_MARKER}\n${body}`;
  }
  if (body.length > MAX_COMMENT_LENGTH) {
    body = `${body.slice(0, MAX_COMMENT_LENGTH)}\n\n…(truncated)`;
  }

  const prNumber = context.payload.pull_request?.number;
  if (!prNumber) {
    core.setFailed('pull_request payload was not found; cannot post comment.');
    return;
  }

  const { owner, repo } = context.repo;
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  const existing = comments.find(c => typeof c.body === 'string' && c.body.includes(COMMENT_MARKER));
  if (existing) {
    await github.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
    core.info(`Updated existing River Reviewer comment (${existing.id}).`);
    return;
  }

  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
  core.info('Created new River Reviewer comment.');
};

