
// ==UserScript==
// @name         GitLab Recent Job Time
// @namespace    http://codelenny.com/
// @version      0.00000000
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

/* jshint esnext: false */
/* jshint esversion: 6 */

/**
 * To load code from the filesystem into TamperMonkey:
 * 1) Serve files from the disk under `localhost`  (e.g. `php -S localhost:2000`)
 * 2) Create a dummy script with `@require http://localhost:2000/gitlab-recent-job-time.js` and exports
 *   `GM_getValue` to `window`
 * 3) Configure TamperMonkey to load changes to resources "Always" (default checks every week or something)
 * Make sure to reload the page twice each time you change the file.
*/
if(!GM_getValue) {
  GM_getValue = window.GM_getValue;
  GM_setValue = window.GM_setValue;
}

/**
 * A basic wrapper for several methods in the GitLab API.
 * @todo Optionally cache all results better.
*/
class GitLabAPI {

  /**
   * Add query options to a URL.
   * @param {String} url the base URL without a query string.
   * @param {Object} opts various options to add to the URL query.
   * @return {String} the formatted URL.
  */
  static urlOpts(url, opts) {
    let addedOpts = false;
    for(const opt in opts) {
      if(!opts.hasOwnProperty(opt)) { continue; }
      url += `${addedOpts ? "&" : "?"}${opt}=${opts[opt]}`;
      addedOpts = true;
    }
    return url;
  }

  /**
   * Execute a `GET` request against the GitLab API.
   * @param {String} url the URL to query
   * @param {String} token the API token to add to the request.
   * @return {Promise<Object>} the JSON object returned from GitLab.
  */
  static getJSON(url, token, server) {
    let req = new XMLHttpRequest();
    if(!req) { return Promise.reject(new Error("Couldn't create an XMLHttpRequest.")); }
    let p = new Promise(function(resolve, reject) {
      req.onreadystatechange = () => {
        if(req.readyState !== XMLHttpRequest.DONE) { return; }
        if(req.status === 200) {
          return resolve(JSON.parse(req.responseText));
        }
        let err = new Error("HTTP request failed.");
        err.status = req.status;
        err.body = req.responseText;
        return reject(err);
      };
    });
    if(!server) { server = this.server || "https://gitlab.com"; }
    console.debug(`GET ${server}${url}`);
    req.open("GET", `${server}${url}`);
    req.setRequestHeader("PRIVATE_TOKEN", token);
    req.send();
    return p;
  }

  /**
   * Converts a project URL (`org/proj`) into a numeric ID.
   * @param {String} namespace the project URL (e.g. `org/proj`).
   * @param {Object} opts additional details to provide.
   * @return {Promise<Number>} the numeric ID of the project.
  */
  static getProjectID(namespace, opts) {
    let encoded = encodeURIComponent(namespace);
    if(!this._projectIDs) { this._projectIDs = {}; }
    if(this._projectIDs[encoded]) { return this._projectIDs[encoded]; }
    return this._projectIDs[encoded] = this
      .getJSON(`/api/v4/projects/${encoded}/`, opts.token)
      .then(data => {
        if(!data) { throw new TypeError(`GitLab didn't return data in 'GET /projects/${encoded}/'`); }
        if(!data.id) {
          console.debug(data);
          throw new ReferenceError(`GitLab didn't return a project ID in 'GET /projects/${encoded}/'`);
        }
        return data.id;
      });
  }

  /**
   * Get the details of a commit.
   * @param {String} sha the commit hash.
   * @param {Object} opts additional details to provide.
   * @return {Promise<Object>} the details of the given commit.
   * @see https://docs.gitlab.com/ee/api/commits.html#get-a-single-commit
  */
  static getCommit(sha, opts) {
    return this.getJSON(`/api/v4/projects/${opts.project}/repository/commits/${sha}`, opts.token);
  }

  /**
   * Get the CI status for a given commit.
   * @param {String} sha the commit hash.
   * @param {Object} opts additional details to provide.
   * @return {Promise<Object>} the status of the given commit.
   * @see https://docs.gitlab.com/ee/api/commits.html#get-the-status-of-a-commit
  */
  static getCommitStatus(sha, opts) {
    let attrs = {};
    if(opts.stage) { attrs.stage = opts.stage; }
    if(opts.name) { attrs.name = opts.name; }
    return this.getJSON(
      this.urlOpts(`/api/v4/projects/${opts.project}/repository/commits/${sha}/statuses`, attrs),
      opts.token
    );
  }

}

/**
 * Adds a "Load Last Build Time" to the CI job list in GitLab.
*/
class RecentTimes {

  get token() { return GM_getValue("gitlab-token"); }

  set token(val) { return GM_setValue("gitlab-token", val); }

  /**
   * Creates the link that should be added to the UI.
  */
  loadTimeLink(opts) {
    if(!opts) { opts = {}; }
    let el = document.createElement("a");
    el.setAttribute("href", "#");
    el.style.color = "#1b69b6";
    el.dataset.loadTime = true;
    el.innerText = opts.text || "Load Last Build Time";
    el.onclick = (e) => {
      e.preventDefault();
      this.loadTime(el.parentElement);
    };
    return el;
  }

  /**
   * Prompt the user for an GitLab API token.
  */
  promptForToken() {
    let t = window.prompt `
      Please enter a GitLab API token.
      Visit https://gitlab.com/profile/personal_access_tokens to create a new token if needed.`;
    if(!t) { return false; }
    this.token = t;
    return t;
  }

  /**
   * Occasionally check if buttons should be added.  Ensures that polling only happens once.
  */
  poll() {
    if(this._poll) { clearInterval(this._poll); }
    this._poll = setInterval(() => this.addButtons(), 2000);
  }

  getProjectName() {
    return window.location.pathname.match(/^\/([^\/]*\/[^\/]*)\//)[1];
  }

  /**
   * Get the commit for the current pipeline.
   * @return {String} returns the commit SHA if found, otherwise `null`.
   * @todo Switch to querying GitLab by pipeline ID (found in URL) instead of parsing the page?
  */
  getCommit() {
    let link = document.querySelector(".branch-info a[href*='/commit']");
    if(!link) {
      console.debug("RecentTimes#getCommit can't find link containing '/commit'.");
      return null;
    }
    let parsed = link.getAttribute("href").match(/\/commit\/([a-zA-Z0-9]+)\/?/);
    if(!parsed || parsed.length < 2) {
      console.debug(`RecentTimes#getCommit can't parse the commit sha out of link ${link.getAttribute("href")}`);
      return null;
    }
    return parsed[1];
  }

  /**
   * Get the name of a CI stage given a `<p data-recent-times>` element.
   * @param {HTMLElement} el the starting element.
   * @return {String} the name of the CI stage, or `null` if something went wrong when searching.
  */
  getStageFromRecentTimes(el) {
    let row = el.parentElement.parentElement;
    if(row.tagName.toLowerCase() !== "tr") { return null; }
    let sib = row.previousSibling;
    while(!sib || !sib.tagName || sib.tagName.toLowerCase() !== "tr" || !sib.querySelector("a[name]")) {
      sib = sib.previousSibling;
    }
    return sib ? sib.querySelector("a[name]").getAttribute("name") : null;
  }

  /**
   * Get the name of a CI job given a `<p data-recent-times>` element.
   * @param {HTMLElement} el the starting element
   * @return {String} the name of the CI job, or `null` if something went wrong when searching.
  */
  getBuildNameFromRecentTimes(el) {
    let cell = el.parentElement;
    if(cell.tagName.toLowerCase() !== "td") { return null; }
    let sib = cell.previousSibling;
    while(!sib || !sib.tagName || sib.tagName.toLowerCase() !== "td") {
      sib = sib.previousSibling;
    }
    return sib ? sib.innerText.trim() : null;
  }

  /**
   * Formats a time into "MM:SS" or "HH:MM:SS"
   * @param {Number} time the time to format, in `ms`.
   * @return {String} `"HH:MM:SS"`
  */
  formatTime(time) {
    function pad(section) { return `${section}`.padStart(2, "0"); }
    let seconds = Math.round(time / 1000);
    let minutes = Math.round(seconds / 60);
    seconds = seconds % 60;
    if(minutes < 60) { return `${pad(minutes)}:${pad(seconds)}`; }
    let hours = Math.round(minutes / 60);
    minutes = minutes % 60;
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }

  /**
   * Load information about a given build.
   * @param {HTMLElement} el the `<p data-recent-times>` element.
   * @todo Improve inserting the results into the UI: instead of using `loadTimeLink` again, create a custom element.
   *   Possibly add an icon, shrink the line a little (smaller than the other text on page), improve wording.
  */
  loadTime(el) {
    let commit = this.getCommit();
    let stage = this.getStageFromRecentTimes(el);
    let name = this.getBuildNameFromRecentTimes(el);
    if(!commit) {
      alert("Sorry, we couldn't figure out what the current commit is.  See console verbose messages.");
      return;
    }
    if(!this.token && !this.promptForToken()) { return; }
    el.removeChild(el.querySelector("[data-load-time]"));
    let project;
    GitLabAPI
      .getProjectID(this.getProjectName(), { token: this.token })
      .then(id => project = id)
      .then(() => GitLabAPI.getCommit(commit, { token: this.token, project, }))
      .then(body => {
        console.log("Got commit.");
        if(!body.parent_ids || body.parent_ids.length < 1) {
          throw new ReferenceError(`Couldn't find parent commits for ${commit}`);
        }
        let parent = body.parent_ids[0];
        let len = body.parent_ids.length;
        console.debug(`RecentTimes#loadTime found ${len} parents for ${commit}.  Using ${parent}.`);
        return GitLabAPI.getCommitStatus(parent, {
          token: this.token,
          project,
          stage,
          name,
        });
      })
      .then(statuses => {
        if(!Array.isArray(statuses)) { throw new TypeError("RecentTimes#loadTime expected to get an array of job statuses."); }
        for(const status of statuses) {
          if(typeof status !== "object" || !status.name || status.name !== name) { continue; }
          let diff = new Date(status["finished_at"]) - new Date(status["started_at"]);
          let formatted = this.formatTime(diff);
          switch(status.status) {
            case "created":
            case "pending":
            case "running":
              el.append(this.loadTimeLink({ text: "Last Pipeline Running" }));
              break;
            case "success":
              el.append(this.loadTimeLink({ text: `Previously took ${formatted}` }));
              break;
            case "failed":
              el.append(this.loadTimeLink({ text: `Previously failed after ${formatted}` }));
              break;
            case "canceled":
              el.append(this.loadTimeLink({ text: `Previously canceled after ${formatted}`}));
              break;
            default:
              console.error(`Unknown job status: ${status.status}`);
              el.append(this.loadTimeLink());
          }
          break;
        }
      })
      .catch(err => {
        el.append(this.loadTimeLink());
        console.error(err);
      });
  }

  /**
   * A UI element that can display recent build information.
  */
  recentTimeElement() {
    // Must be a <p> element with [data-recent-times] to be recognized.
    let element = document.createElement("p");
    element.dataset.recentTimes = "data-recent-times";
    element.style.margin = "4px 0";
    element.append(this.loadTimeLink());
    return element;
  }

  /**
   * Add an element to each job line in the pipeline table display recent build time information.
  */
  addButtons() {
    if(document.querySelector("table.ci-table.pipeline") === null) { return; }
    let durations = document.querySelectorAll("table.ci-table.pipeline td p.duration");
    for (const duration of durations) {
      if(duration.parentElement.querySelector("p[data-recent-times]") !== null) { continue; }
      duration.parentElement.insertBefore(this.recentTimeElement(), duration);
    }
  }

}


/**
 * Forks are welcome to keep using ["com.codelenny.gitlab-recent-job-time"].  This will save the user if they install
 * two different forks of the codebase, or have both a development and production version installed.
*/
if(window["com.codelenny.gitlab-recent-job-time"]) {
  console.debug(`
    gitlab-recent-job-time UserScript has already been loaded.  Refusing to load again.
    Access the currently running UserScript in the console via 'window["com.codelenny.gitlab-recent-job-time"]'.

    Handy methods: 'addButtons()' will insert elements for each job that is missing a 'recent times' element.
  `);
}
else {
  console.debug("Loading gitlab-recent-job-time UserScript.");
  let recent;
  window["com.codelenny.gitlab-recent-job-time"] = recent = new RecentTimes();
  recent.addButtons();
  recent.poll();
}
