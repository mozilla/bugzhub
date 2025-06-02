var bugz = (function() {

class Bug {
  constructor(data) {
    this._data = data;
  }

  get id() {
    return this._data.id;
  }

  get isAssigned() {
    return this._data.assignee !== null;
  }

  get assignee() {
    return this._data.assignee;
  }

  get title() {
    return this._data.title;
  }

  get labels() {
    return [];
  }

  get whiteboard() {
    return "";
  }

  get url() {
    return this._data.url;
  }

  get hasPriority() {
    return this._data.priority !== null;
  }

  get priority() {
    return this._data.priority;
  }

  get points() {
    return this._data.points;
  }

  get project() {
    return "";
  }

  get isPullRequest() {
    return false;
  }

  get mentors() {
    return [];
  }

  get resolution() {
    return "";
  }

  get severity() {
    return null;
  }

  get type() {
    return null;
  }

  get needinfo() {
    return null;
  }
}

class GithubIssue extends Bug {
  get whiteboard() {
    return this._data.labels
      .filter(l => !l.match(/^priority:[0-9]$/))
      .map(l => "[" + l + "]")
      .join(" ");
  }

  get project() {
    return this._data.project;
  }

  get isPullRequest() {
    return this._data.isPullRequest;
  }
}

class BugzillaBug extends Bug {
  get whiteboard() {
    return this._data.whiteboard;
  }

  get isAssigned() {
    return this._data.assignee !== "nobody@mozilla.org";
  }

  get project() {
    return this._data.component;
  }

  get mentors() {
    return this._data.mentors;
  }

  get resolution() {
    return this._data.resolution;
  }

  get severity() {
    return this._data.severity;
  }

  get type() {
    return this._data.type;
  }

  get needinfo() {
    // "needinfo" is flag type 800, per:
    // https://bmo.readthedocs.io/en/latest/api/core/v1/flag-activity.html
    return this._data.flags.filter(f => f.type_id === 800)[0];
  }
}

async function loadIssuesFromGithubRepo(searchParams) {
  try {
    let {search, filters} = searchParams;

    let projectIssues = gh.getIssues(search.user, search.project);
    let queryParams = {
      state: (filters && filters.open) ? "open" : "closed",
    };
    let response = await projectIssues.listIssues(queryParams);

    let mapped = response.data.map(is => {
      let data = {
        id: "gh:" + is.id,
        assignee: null,
        points: null,
        title: is.title,
        lastChangeDate: is.updated_at,
        url: is.html_url,
        whiteboard: null,
        priority: null,
        labels: null,
        project: search.project,
        isPullRequest: ("pull_request" in is),
      };

      if (is.assignee) {
        data.assignee = is.assignee.login;
      } else if (data.isPullRequest) {
        data.assignee = is.user.login;
      }

      let labelNames = is.labels.map(l => l.name);
      data.labels = labelNames;
      if (data.isPullRequest) {
        data.labels.push("pr");
      }

      let priorityLabel = labelNames.find(l => l.match(/^priority:[0-9]$/));
      if (priorityLabel) {
        data.priority = priorityLabel.split(":")[1];
      }

      return new GithubIssue(data);
    });

    return mapped;
  } catch (e) {
    // A failure in loading GitHub issues shouldn't break the site.
    console.log("Failed to fetch data from GitHub.", e);
    return [];
  }
}

async function loadBugsFromBugzilla(searchParams) {
  let {search, filters} = searchParams;
  let queryParams = {};

  // Set up basic search type.
  switch (search.type) {
  case "bugzillaComponent":
    queryParams.product = search.product;
    queryParams.component = search.component;
    //queryParams.quicksearch = `product:"${search.product}" component:"${search.component}"`;
    break;
  case "bugzillaAssignees":
    queryParams.quicksearch = `assigned_to:${search.assignees.join(',')}`;
    break;
  case "bugzillaMentors":
    //queryParams.quicksearch = `mentor:"${search.mentors.join(',')}"`;
    queryParams.emailtype1 = "regexp";
    queryParams.email1 = teamEmails.join("|");
    queryParams.emailbug_mentor1 = "1";
    break;
  case "bugzillaWhiteboard":
    queryParams.quicksearch = `whiteboard:"${search.whiteboardContent}"`;
    break;
  default:
    throw new Error("Oops... unsupported query type.");
  }

  // Add query-time filters.
  if (filters) {
    if ("priority" in filters) {
      queryParams.priority = "P" + filters.priority;
    }
    if ("open" in filters) {
      if (filters.open) {
        queryParams.resolution = "---";
      } else {
        queryParams.resolution = ["FIXED",
                                  "INVALID",
                                  "WONTFIX",
                                  "DUPLICATE",
                                  "WORKSFORME",
                                  "INCOMPLETE"];
      }
    }
    if ("isAssigned" in filters) {
      queryParams.emailtype2 = filters.isAssigned ? "notequals" : "equals";
      queryParams.email2 = "nobody@mozilla.org";
      queryParams.emailassigned_to2 = "1";
    }
    if ("whiteboard" in filters) {
      queryParams.whiteboard = filters.whiteboard;
    }
    if ("notWhiteboard" in filters) {
      queryParams.whiteboard = filters.notWhiteboard;
      queryParams.status_whiteboard_type = "notregexp";
    }
    if ("lastChangeTime" in filters) {
      queryParams.last_change_time = filters.lastChangeTime.toISOString();
    }
  }

  // We don't want _all_ the fields.
  const include_fields = [
    "id",
    "summary",
    "whiteboard",
    "product",
    "component",
    "assigned_to",
    "cf_fx_points",
    "priority",
    "mentors",
    "resolution",
    "severity",
    "type",
    "flags",
  ].join(",");
  queryParams.include_fields = include_fields;

  let bugs = await new Promise((resolve, reject) => {
    bugzilla.searchBugs(queryParams, (error, bugs) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(bugs);
    });
  });

  let mapped = bugs.map(b => {
    let data = {
      id: "bz:" + b.id,
      assignee: null,
      points: null,
      title: b.summary,
      lastChangeDate: null,
      url: "https://bugzilla.mozilla.org/show_bug.cgi?id=" + b.id,
      whiteboard: b.whiteboard,
      priority: null,
      labels: null,
      product: b.product,
      component: b.component,
      mentors: b.mentors,
      resolution: b.resolution,
      severity: b.severity,
      flags: b.flags,
    };

    if (b.assigned_to !== "nobody@mozilla.org") {
      data.assignee = b.assigned_to;
    }

    if (b.cf_fx_points !== "---") {
      data.points = parseInt(b.cf_fx_points, 10);
    }

    if (b.priority !== "--") {
      data.priority = parseInt(b.priority.substring(1), 10);
    }

    return new BugzillaBug(data);
  });

  return mapped;
}

function findBugs(searchParams) {
  let queryWords = new Map([
    ["githubRepo", loadIssuesFromGithubRepo],
    ["bugzillaComponent", loadBugsFromBugzilla],
    ["bugzillaAssignees", loadBugsFromBugzilla],
    ["bugzillaMentors", loadBugsFromBugzilla],
    ["bugzillaWhiteboard", loadBugsFromBugzilla],
  ]);

  let {search} = searchParams;
  if (!search || !(queryWords.has(search.type))) {
    throw new Error("Oops ... unsupported bug search type.");
  }

  return queryWords.get(search.type)(searchParams);
}

function filterBugs(bugs, searchParams) {
  let {filters} = searchParams;
  if (!filters) {
    return bugs;
  }

  if ("unprioritized" in filters) {
    bugs = bugs.filter(b => b.priority === null);
  }
  if ("priority" in filters) {
    bugs = bugs.filter(b => String(b.priority) === String(filters.priority));
  }
  if ("customFilter" in filters) {
    bugs = bugs.filter(b => filters.customFilter(b));
  }
  if ("assignees" in filters) {
    bugs = bugs.filter(b => filters.assignees.includes(b.assignee));
  }
  if ("isPullRequest" in filters) {
    bugs = bugs.filter(b => b.isPullRequest == filters.isPullRequest);
  }

  return bugs;
}

const bugPromiseCache = new Map();

this.findBugs = async function(searchList) {
  let buglists = [];
  for (let search of searchList) {
    // TODO: non-hackish way to cache this.
    let cacheKey = JSON.stringify(search);
    let cachePromise = bugPromiseCache.get(cacheKey);

    if (cachePromise === undefined) {
      let bugsPromise = findBugs(search);
      bugPromiseCache.set(cacheKey, bugsPromise);
    }

    // The cacheKey doesn't know about filter logic,
    // So we need to filter after taking it out of the cache.
    buglists.push(await bugPromiseCache.get(cacheKey)
            .then(bugs => filterBugs(bugs, search)));
  }

  let bugMaps = buglists.map(bl => new Map(bl.map(b => [b.id, b])));
  let uniques = new Map();
  bugMaps.forEach(bm => uniques = new Map([...uniques, ...bm]));
  let joined = [...uniques.values()];

  return joined;
}

return this;

})();
