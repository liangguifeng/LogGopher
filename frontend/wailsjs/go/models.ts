export namespace domain {

	export class AdapterInfo {
	    id: string;
	    name: string;
	    description: string;
	    ready: boolean;

	    static createFrom(source: any = {}) {
	        return new AdapterInfo(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.ready = source["ready"];
	    }
	}
	export class Settings {
	    theme: string;
	    language: string;
	    density: string;

	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.theme = source["theme"];
	        this.language = source["language"];
	        this.density = source["density"];
	    }
	}
	export class Profile {
	    id: number;
	    adapterId: string;
	    name: string;
	    endpoint: string;
	    project: string;
	    region: string;

	    static createFrom(source: any = {}) {
	        return new Profile(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.adapterId = source["adapterId"];
	        this.name = source["name"];
	        this.endpoint = source["endpoint"];
	        this.project = source["project"];
	        this.region = source["region"];
	    }
	}
	export class Bootstrap {
	    adapters: AdapterInfo[];
	    profiles: Profile[];
	    settings: Settings;

	    static createFrom(source: any = {}) {
	        return new Bootstrap(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.adapters = this.convertValues(source["adapters"], AdapterInfo);
	        this.profiles = this.convertValues(source["profiles"], Profile);
	        this.settings = this.convertValues(source["settings"], Settings);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ConnectionInput {
	    adapterId: string;
	    name: string;
	    endpoint: string;
	    accessKey: string;
	    secretKey: string;
	    project: string;
	    region: string;

	    static createFrom(source: any = {}) {
	        return new ConnectionInput(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.adapterId = source["adapterId"];
	        this.name = source["name"];
	        this.endpoint = source["endpoint"];
	        this.accessKey = source["accessKey"];
	        this.secretKey = source["secretKey"];
	        this.project = source["project"];
	        this.region = source["region"];
	    }
	}
	export class HistogramBucket {
	    from: string;
	    to: string;
	    count: number;

	    static createFrom(source: any = {}) {
	        return new HistogramBucket(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.from = source["from"];
	        this.to = source["to"];
	        this.count = source["count"];
	    }
	}
	export class LogEntry {
	    time: string;
	    level: string;
	    message: string;
	    messageField: string;
	    fields: Record<string, string>;

	    static createFrom(source: any = {}) {
	        return new LogEntry(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.time = source["time"];
	        this.level = source["level"];
	        this.message = source["message"];
	        this.messageField = source["messageField"];
	        this.fields = source["fields"];
	    }
	}
	export class LogGroup {
	    name: string;
	    logstores: string[];

	    static createFrom(source: any = {}) {
	        return new LogGroup(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.logstores = source["logstores"];
	    }
	}

	export class ProfileCredentials {
	    accessKey: string;
	    secretKey: string;

	    static createFrom(source: any = {}) {
	        return new ProfileCredentials(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.accessKey = source["accessKey"];
	        this.secretKey = source["secretKey"];
	    }
	}
	export class QueryHistoryItem {
	    query: string;
	    updatedAt: string;

	    static createFrom(source: any = {}) {
	        return new QueryHistoryItem(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.query = source["query"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class QueryInput {
	    profileId: number;
	    group: string;
	    logstore: string;
	    query: string;
	    from: string;
	    to: string;
	    page: number;
	    limit: number;

	    static createFrom(source: any = {}) {
	        return new QueryInput(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.profileId = source["profileId"];
	        this.group = source["group"];
	        this.logstore = source["logstore"];
	        this.query = source["query"];
	        this.from = source["from"];
	        this.to = source["to"];
	        this.page = source["page"];
	        this.limit = source["limit"];
	    }
	}
	export class QueryResult {
	    tookMs: number;
	    total: number;
	    entries: LogEntry[];
	    histogram: HistogramBucket[];
	    indexedFields: string[];
	    fullTextIndex: boolean;
	    effectiveQuery: string;

	    static createFrom(source: any = {}) {
	        return new QueryResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tookMs = source["tookMs"];
	        this.total = source["total"];
	        this.entries = this.convertValues(source["entries"], LogEntry);
	        this.histogram = this.convertValues(source["histogram"], HistogramBucket);
	        this.indexedFields = source["indexedFields"];
	        this.fullTextIndex = source["fullTextIndex"];
	        this.effectiveQuery = source["effectiveQuery"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Session {
	    profileId: number;
	    groups: LogGroup[];

	    static createFrom(source: any = {}) {
	        return new Session(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.profileId = source["profileId"];
	        this.groups = this.convertValues(source["groups"], LogGroup);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

