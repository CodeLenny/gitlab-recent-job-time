
// ==UserScript==
// @name         GitLab Recent Job Time
// @namespace    http://codelenny.com/
// @version      0.00010000
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
