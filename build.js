const fs = require("fs");
const path = require("path");

String.prototype.padStart = function padStart(len, add) {
  return (Array(len).join(add) + this).slice(-len);
}

/**
 * Produces a 2-digit version number from a 3-digit semver string.
*/
function simplifySemVer(v) {
  let a, b, c;
  [a, b, c] = v.split(".");
  return `${a}.${b.padStart(4, "0")}${c.padStart(4, "0")}`;
}

const semver = process.env.VERSION || require("./package.json").version;

const version = simplifySemVer(semver);

const header = `
// ==UserScript==
// @name         GitLab Recent Job Time
// @namespace    http://codelenny.com/
// @version      ${version}
// @description  Queries GitLab to determine how long a CI job took the last time it was run.
// @author       Ryan Leonard
// @require      https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/6.18.2/babel.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/babel-polyfill/6.16.0/polyfill.js
// @connect      gitlab.com
// @grant        GM_getValue
// @grant        GM_setValue
// @match        https://gitlab.com/*/pipelines/*
// @updateURL    https://raw.githubusercontent.com/CodeLenny/gitlab-recent-job-time/master/gitlab-recent-job-time.meta.js
// @downloadURL  https://raw.githubusercontent.com/CodeLenny/gitlab-recent-job-time/master/gitlab-recent-job-time.user.js
// ==/UserScript==
`;

const script = fs.readFileSync(path.join(__dirname, "gitlab-recent-job-time.js"), "utf8");

fs.writeFileSync(path.join(__dirname, "gitlab-recent-job-time.meta.js"), header);
fs.writeFileSync(path.join(__dirname, "gitlab-recent-job-time.user.js"), `${header}\n${script}`);
