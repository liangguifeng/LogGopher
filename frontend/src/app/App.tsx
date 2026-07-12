import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "../styles/app.css";
import "../styles/settings.css";
import "../styles/workspace-scale.css";
import "../styles/functional-theme.css";
import {
  Bootstrap,
  Connect,
  ConnectSaved,
  Query,
  QueryHistory as LoadQueryHistory,
  SaveSettings,
} from "../../wailsjs/go/main/App";
import { EventsOn } from "../../wailsjs/runtime/runtime";
import DateTimeField from "../components/date-time-picker/DateTimeField";
import LogResults from "../features/log-results/LogResults";

/** Adapter metadata rendered by the connection workflow. */
type Adapter = { id: string; name: string; ready: boolean };
/** Non-secret metadata for a saved platform connection. */
type Profile = {
  id: number;
  adapterId: string;
  name: string;
  endpoint: string;
  project: string;
  region: string;
};
/** Normalized log record returned through the Wails bridge. */
type Entry = {
  time: string;
  level: string;
  message: string;
  fields: Record<string, string>;
};
/** One paginated query response. */
type Result = { tookMs: number; total: number; entries: Entry[] };
/** User preferences supported by both the native menu and React UI. */
type Settings = {
  theme: "system" | "light" | "dark";
  language: "zh-CN" | "en-US";
  density: "comfortable" | "compact";
};
/** Concrete time interval used by queries and histogram drill-down. */
type TimeRange = { key: string; label: string; from: string; to: string };
/** Persisted query history item returned by the backend. */
type QueryHistoryItem = { query: string; updatedAt: string };

/** Serializes a Date for the vendor-neutral query contract. */
const iso = (date: Date) => date.toISOString();
/** Builds a relative range ending at the current time. */
const relativeRange = (
  key: string,
  label: string,
  milliseconds: number,
): TimeRange => {
  const to = new Date();
  return {
    key,
    label,
    from: iso(new Date(to.getTime() - milliseconds)),
    to: iso(to),
  };
};
/** Formats histogram axis labels according to the visible time span. */
const axisLabel = (date: Date, span: number, locale: "zh-CN" | "en-US") =>
  span <= 3600000
    ? date.toLocaleTimeString(locale, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
    : span <= 86400000
      ? date.toLocaleTimeString(locale, {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : date.toLocaleDateString(locale, { month: "2-digit", day: "2-digit" });
/** Collects nested JSON paths for query editor completion. */
const collectFieldPaths = (
  value: unknown,
  prefix: string,
  paths: Set<string>,
) => {
  if (!value || typeof value !== "object") return;
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    paths.add(path);
    collectFieldPaths(item, path, paths);
  });
};

const defaults: Settings = {
  theme: "system",
  language: "zh-CN",
  density: "comfortable",
};
const messages = {
  "zh-CN": {
    saved: "已保存连接",
    emptyStore: "连接后在这里浏览日志库",
    newConnection: "新建连接",
    choose: "日志平台",
    pending: "SDK 待接入",
    connectionAlias: "连接别名",
    aliasPlaceholder: "例如：杭州生产环境",
    project: "Project",
    region: "地域",
    connecting: "正在连接…",
    recent: "最近 15 分钟",
    querying: "查询中…",
    settingsTitle: "偏好设置",
    appearance: "外观",
    system: "跟随系统",
    light: "亮色",
    dark: "暗色",
    language: "语言",
    chinese: "简体中文",
    english: "English",
    density: "显示密度",
    comfortable: "舒适",
    compact: "紧凑",
    cancel: "取消",
    save: "保存设置",
    saving: "保存中…",
    noSaved: "还没有保存过连接，请先新建连接。",
    logstores: "日志库",
    connections: "连接管理",
    unnamedConnection: "未命名连接",
    secretId: "SecretId",
    endpoint: "访问端点",
    accessKey: "Access Key",
    secretKey: "Secret Key",
  },
  "en-US": {
    saved: "Saved connections",
    emptyStore: "Connect to browse logstores",
    newConnection: "New connection",
    choose: "Log platform",
    pending: "SDK pending",
    connectionAlias: "Connection alias",
    aliasPlaceholder: "For example: Hangzhou production",
    project: "Project",
    region: "Region",
    connecting: "Connecting…",
    recent: "Last 15 minutes",
    querying: "Searching…",
    settingsTitle: "Preferences",
    appearance: "Appearance",
    system: "System",
    light: "Light",
    dark: "Dark",
    language: "Language",
    chinese: "简体中文",
    english: "English",
    density: "Display density",
    comfortable: "Comfortable",
    compact: "Compact",
    cancel: "Cancel",
    save: "Save settings",
    saving: "Saving…",
    noSaved: "No saved connections yet. Create one first.",
    logstores: "LOGSTORES",
    connections: "CONNECTIONS",
    unnamedConnection: "Unnamed connection",
    secretId: "SecretId",
    endpoint: "ENDPOINT",
    accessKey: "Access Key",
    secretKey: "Secret Key",
  },
} as const;

const emptyForm = {
  adapterId: "aliyun-sls",
  name: "",
  endpoint: "",
  accessKey: "",
  secretKey: "",
  project: "",
  region: "",
};

/** Coordinates connection management, querying, preferences, and Wails events. */
function App() {
  const [adapters, setAdapters] = useState<Adapter[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [connectionMode, setConnectionMode] = useState<"saved" | "new">("new");
  const [savedProfileId, setSavedProfileId] = useState(0);
  const [savedSearch, setSavedSearch] = useState("");
  const [savedPage, setSavedPage] = useState(1);
  const [configSwitcherOpen, setConfigSwitcherOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [profileId, setProfileId] = useState(0);
  const [logstores, setLogstores] = useState<string[]>([]);
  const [logstore, setLogstore] = useState("");
  const [logSidebarCollapsed, setLogSidebarCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<Settings>(defaults);
  const [draftSettings, setDraftSettings] = useState<Settings>(defaults);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [customTimeOpen, setCustomTimeOpen] = useState(false);
  const [exactTime, setExactTime] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>(() =>
    relativeRange("15m", "15min", 15 * 60 * 1000),
  );
  const [draftTimeRange, setDraftTimeRange] = useState<TimeRange>(() =>
    relativeRange("15m", "15min", 15 * 60 * 1000),
  );
  const [timeHistory, setTimeHistory] = useState<TimeRange[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [queryFavorite, setQueryFavorite] = useState(false);
  const [queryAssistOpen, setQueryAssistOpen] = useState(false);
  const [queryHistory, setQueryHistory] = useState<QueryHistoryItem[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [hoveredBucket, setHoveredBucket] = useState<number | null>(null);
  const timePickerRef = useRef<HTMLDivElement>(null);
  const queryEditorRef = useRef<HTMLDivElement>(null);
  const queryTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    Bootstrap()
      .then((data: any) => {
        const saved = data.profiles || [];
        setAdapters(data.adapters || []);
        setProfiles(saved);
        if (saved.length) {
          setConnectionMode("saved");
          setSavedProfileId(saved[0].id);
        }
        const next = data.settings || defaults;
        setSettings(next);
        setDraftSettings(next);
      })
      .catch((e) => setError(String(e)));
  }, []);
  const effectiveSettings = settingsOpen ? draftSettings : settings;
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      (document.documentElement.dataset.theme =
        effectiveSettings.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : effectiveSettings.theme);
    apply();
    document.documentElement.dataset.density = effectiveSettings.density;
    document.documentElement.lang = effectiveSettings.language;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [effectiveSettings]);
  useEffect(() => {
    const updateSetting = async (patch: Partial<Settings>) => {
      const next = { ...settings, ...patch };
      try {
        await SaveSettings(next);
        setSettings(next);
        setDraftSettings(next);
      } catch (e) {
        setError(String(e));
      }
    };
    const off = [
      EventsOn("menu:open-settings", () => openSettings()),
      EventsOn("menu:new-connection", () => {
        resetWorkspace();
        setConnectionMode("new");
      }),
      EventsOn("menu:reconnect", () => {
        if (profileId) connectSavedProfile(profileId);
      }),
      EventsOn("menu:set-theme", (value: string) =>
        updateSetting({ theme: value as Settings["theme"] }),
      ),
      EventsOn("menu:set-language", (value: string) =>
        updateSetting({ language: value as Settings["language"] }),
      ),
      EventsOn("menu:set-density", (value: string) =>
        updateSetting({ density: value as Settings["density"] }),
      ),
    ];
    return () => off.forEach((fn) => fn());
  }, [profileId, settings]);
  useEffect(() => {
    if (!timePickerOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (timePickerRef.current?.contains(event.target as Node)) return;
      commitTimeRange(draftTimeRange, false);
      setTimePickerOpen(false);
      setCustomTimeOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside, true);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutside, true);
  }, [timePickerOpen, draftTimeRange, exactTime]);
  useEffect(() => {
    if (!queryAssistOpen) return;
    const close = (event: PointerEvent) => {
      if (!queryEditorRef.current?.contains(event.target as Node))
        setQueryAssistOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [queryAssistOpen]);
  const selected = useMemo(
    () => adapters.find((a) => a.id === form.adapterId),
    [adapters, form.adapterId],
  );
  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === profileId),
    [profiles, profileId],
  );
  const t = messages[effectiveSettings.language];
  const savedPageSize = 6;
  const filteredProfiles = useMemo(() => {
    const keyword = savedSearch.trim().toLowerCase();
    if (!keyword) return profiles;
    return profiles.filter((profile) => {
      const adapter = adapters.find((item) => item.id === profile.adapterId);
      return [
        profile.name,
        profile.endpoint,
        profile.project,
        profile.region,
        adapter?.name,
        profile.adapterId,
      ].some((value) => value?.toLowerCase().includes(keyword));
    });
  }, [profiles, adapters, savedSearch]);
  const savedPageCount = Math.max(
    1,
    Math.ceil(filteredProfiles.length / savedPageSize),
  );
  const visibleProfiles = filteredProfiles.slice(
    (Math.min(savedPage, savedPageCount) - 1) * savedPageSize,
    Math.min(savedPage, savedPageCount) * savedPageSize,
  );
  const timeText =
    effectiveSettings.language === "zh-CN"
      ? {
          select: "时间选择",
          exact: "整点时间",
          history: "历史记录",
          custom: "自定义",
          from: "开始时间",
          to: "结束时间",
        }
      : {
          select: "Time range",
          exact: "Exact minute",
          history: "History",
          custom: "Custom",
          from: "Start time",
          to: "End time",
        };
  const queryText =
    effectiveSettings.language === "zh-CN"
      ? {
          placeholder: "输入查询语句、SQL、SPL",
          run: "查询 / 分析",
          count: "日志条数",
          favorite: "收藏查询",
        }
      : {
          placeholder: "Enter query, SQL or SPL",
          run: "Search / Analyze",
          count: "Log count",
          favorite: "Favorite query",
        };
  const adapterText = (adapter?: Adapter) => {
    if (!adapter) return { name: "" };
    const localized: Record<string, { zh: string; en: string }> = {
      "aliyun-sls": { zh: "阿里云 SLS", en: "Alibaba Cloud SLS" },
      "tencent-cls": { zh: "腾讯云 CLS", en: "Tencent Cloud CLS" },
      "aws-cloudwatch": { zh: "AWS CloudWatch", en: "AWS CloudWatch" },
    };
    const text = localized[adapter.id];
    return {
      name: text
        ? effectiveSettings.language === "zh-CN"
          ? text.zh
          : text.en
        : adapter.name,
    };
  };
  const histogram = useMemo(() => {
    const bucketCount = 18;
    const counts = Array(bucketCount).fill(0) as number[];
    const start = new Date(timeRange.from).getTime();
    const end = new Date(timeRange.to).getTime();
    const span = Math.max(1, end - start);
    for (const entry of result?.entries || []) {
      const timestamp = new Date(entry.time).getTime();
      if (timestamp < start || timestamp > end) continue;
      const index = Math.min(
        bucketCount - 1,
        Math.floor(((timestamp - start) / span) * bucketCount),
      );
      counts[index]++;
    }
    const max = Math.max(1, ...counts);
    const labels = counts.map((_, index) => {
      if (index % 3 !== 0 && index !== bucketCount - 1) return "";
      return axisLabel(
        new Date(start + (span * index) / bucketCount),
        span,
        effectiveSettings.language,
      );
    });
    return { counts, max, labels };
  }, [result, timeRange, effectiveSettings.language]);
  const fieldSuggestions = useMemo(() => {
    const paths = new Set<string>(["level", "message"]);
    for (const entry of result?.entries || []) {
      for (const [field, raw] of Object.entries(entry.fields)) {
        paths.add(field);
        try {
          collectFieldPaths(JSON.parse(raw), field, paths);
        } catch {}
      }
    }
    const token =
      query
        .slice(0, queryTextareaRef.current?.selectionStart ?? query.length)
        .match(/[\w.-]*$/)?.[0]
        ?.toLowerCase() || "";
    return [...paths]
      .filter((field) => !token || field.toLowerCase().includes(token))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 8);
  }, [result, query]);

  /** Saves a new connection and opens its first available logstore. */
  async function connect(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const s: any = await Connect({ ...form, name: form.name.trim() });
      await applySession(s);
      const data: any = await Bootstrap();
      setProfiles(data.profiles || []);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  /** Restores credentials and connects a previously saved profile. */
  async function connectSavedProfile(id = savedProfileId) {
    if (!id) return;
    setBusy(true);
    setError("");
    try {
      await applySession((await ConnectSaved(id)) as any);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  /** Applies a backend session and eagerly loads its first logstore. */
  async function applySession(session: {
    profileId: number;
    logstores: string[];
  }) {
    const stores = session.logstores || [];
    const firstStore = stores[0] || "";
    setProfileId(session.profileId);
    setLogstores(stores);
    setLogstore(firstStore);
    setLogSidebarCollapsed(false);
    setQuery("");
    setResult(null);
    if (firstStore)
      await executeQuery(session.profileId, firstStore, "", timeRange);
  }
  /** Clears connection-specific UI state and returns to the connection home. */
  function resetWorkspace() {
    setProfileId(0);
    setLogstores([]);
    setLogstore("");
    setResult(null);
    setCurrentPage(1);
    setError("");
  }
  /** Executes a paginated query while keeping loading and error state consistent. */
  async function executeQuery(
    targetProfileID: number,
    targetLogstore: string,
    queryValue: string,
    range: TimeRange,
    targetPage = 1,
    targetPageSize = pageSize,
  ) {
    if (!targetProfileID || !targetLogstore) return;
    setBusy(true);
    setError("");
    try {
      setResult(
        (await Query({
          profileId: targetProfileID,
          logstore: targetLogstore,
          query: queryValue,
          from: range.from,
          to: range.to,
          page: targetPage,
          limit: targetPageSize,
        })) as Result,
      );
      setCurrentPage(targetPage);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  /** Runs the current editor text against the active logstore. */
  async function search() {
    setQueryAssistOpen(false);
    await executeQuery(profileId, logstore, query, timeRange);
  }
  /** Opens query completion and loads persisted history for the active scope. */
  async function openQueryAssist() {
    setQueryAssistOpen(true);
    setSuggestionIndex(0);
    try {
      setQueryHistory(
        (await LoadQueryHistory(profileId, logstore)) as QueryHistoryItem[],
      );
    } catch {
      setQueryHistory([]);
    }
  }
  /** Replaces the token at the caret with a selected field completion. */
  function applySuggestion(field: string) {
    const textarea = queryTextareaRef.current;
    const cursor = textarea?.selectionStart ?? query.length;
    const before = query.slice(0, cursor);
    const token = before.match(/[\w.-]*$/)?.[0] || "";
    const next = `${before.slice(0, before.length - token.length)}${field}:${query.slice(cursor)}`;
    setQuery(next);
    setQueryAssistOpen(false);
    requestAnimationFrame(() => {
      if (textarea) {
        const position = cursor - token.length + field.length + 1;
        textarea.focus();
        textarea.setSelectionRange(position, position);
      }
    });
  }
  /** Restores and immediately executes one persisted query. */
  function runHistory(item: QueryHistoryItem) {
    setQuery(item.query);
    setQueryAssistOpen(false);
    void executeQuery(profileId, logstore, item.query, timeRange);
  }
  /** Implements completion navigation, query execution, and explicit line breaks. */
  function handleQueryKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (queryAssistOpen && fieldSuggestions.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setSuggestionIndex(
          (index) =>
            (index +
              (event.key === "ArrowDown" ? 1 : -1) +
              fieldSuggestions.length) %
            fieldSuggestions.length,
        );
        return;
      }
      if (
        event.key === "Tab" ||
        (event.key === "Enter" && !event.metaKey && !event.ctrlKey)
      ) {
        event.preventDefault();
        applySuggestion(
          fieldSuggestions[suggestionIndex] || fieldSuggestions[0],
        );
        return;
      }
    }
    if (event.key === "Escape") {
      setQueryAssistOpen(false);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      insertQueryLineBreak(event.currentTarget);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void search();
    }
  }
  /** Adds an include or exclude clause for a clicked result value. */
  function filterByValue(field: string, value: unknown, exclude: boolean) {
    const encoded =
      typeof value === "string"
        ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
        : String(value);
    const clause = `${field}:${encoded}`;
    const next = [query.trim(), exclude ? `NOT ${clause}` : clause]
      .filter(Boolean)
      .join(" AND ");
    setQuery(next);
    void executeQuery(profileId, logstore, next, timeRange);
  }
  /** Inserts a newline at the current selection without losing editor focus. */
  function insertQueryLineBreak(element: HTMLTextAreaElement) {
    const start = element.selectionStart;
    const end = element.selectionEnd;
    setQuery((value) => `${value.slice(0, start)}\n${value.slice(end)}`);
    requestAnimationFrame(() => {
      element.selectionStart = element.selectionEnd = start + 1;
    });
  }
  /** Loads another result page without changing the active query. */
  function changePage(nextPage: number) {
    void executeQuery(
      profileId,
      logstore,
      query,
      timeRange,
      nextPage,
      pageSize,
    );
  }
  /** Applies a new page size and resets pagination to the first page. */
  function changePageSize(nextPageSize: number) {
    setPageSize(nextPageSize);
    void executeQuery(profileId, logstore, query, timeRange, 1, nextPageSize);
  }
  /** Selects a logstore and refreshes its result set. */
  function selectLogstore(nextLogstore: string) {
    setLogstore(nextLogstore);
    setResult(null);
    void executeQuery(profileId, nextLogstore, query, timeRange);
  }
  /** Switches directly between saved profiles from the workspace sidebar. */
  async function switchProfile(nextProfileID: number) {
    setConfigSwitcherOpen(false);
    if (nextProfileID === profileId) return;
    setSavedProfileId(nextProfileID);
    await connectSavedProfile(nextProfileID);
  }
  /** Ends the current UI session and opens the new connection workflow. */
  function exitCurrentProfile() {
    setConfigSwitcherOpen(false);
    resetWorkspace();
    setConnectionMode("new");
    setForm({ ...emptyForm });
  }
  const createPreset = (
    key: string,
    label: string,
    from: Date,
    to = new Date(),
  ): TimeRange => ({ key, label, from: iso(from), to: iso(to) });
  const timePresets = () => {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(dayStart);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekStart = new Date(dayStart);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const quarterStart = new Date(
      now.getFullYear(),
      Math.floor(now.getMonth() / 3) * 3,
      1,
    );
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const zh = effectiveSettings.language === "zh-CN";
    return [
      [
        "1m",
        zh ? "1分钟" : "1 min",
        () => relativeRange("1m", zh ? "1分钟" : "1 min", 60000),
      ],
      [
        "5m",
        zh ? "5分钟" : "5 min",
        () => relativeRange("5m", zh ? "5分钟" : "5 min", 300000),
      ],
      [
        "15m",
        zh ? "15分钟" : "15 min",
        () => relativeRange("15m", zh ? "15分钟" : "15 min", 900000),
      ],
      [
        "1h",
        zh ? "1小时" : "1 hour",
        () => relativeRange("1h", zh ? "1小时" : "1 hour", 3600000),
      ],
      [
        "4h",
        zh ? "4小时" : "4 hours",
        () => relativeRange("4h", zh ? "4小时" : "4 hours", 14400000),
      ],
      [
        "1d",
        zh ? "1天" : "1 day",
        () => relativeRange("1d", zh ? "1天" : "1 day", 86400000),
      ],
      [
        "today",
        zh ? "今天" : "Today",
        () => createPreset("today", zh ? "今天" : "Today", dayStart, now),
      ],
      [
        "yesterday",
        zh ? "昨天" : "Yesterday",
        () =>
          createPreset(
            "yesterday",
            zh ? "昨天" : "Yesterday",
            yesterday,
            dayStart,
          ),
      ],
      [
        "beforeYesterday",
        zh ? "前天" : "Day before",
        () => {
          const start = new Date(yesterday);
          start.setDate(start.getDate() - 1);
          return createPreset(
            "beforeYesterday",
            zh ? "前天" : "Day before",
            start,
            yesterday,
          );
        },
      ],
      [
        "1w",
        zh ? "1周" : "1 week",
        () => relativeRange("1w", zh ? "1周" : "1 week", 604800000),
      ],
      [
        "thisWeek",
        zh ? "本周" : "This week",
        () =>
          createPreset("thisWeek", zh ? "本周" : "This week", weekStart, now),
      ],
      [
        "lastWeek",
        zh ? "上周" : "Last week",
        () => {
          const start = new Date(weekStart);
          start.setDate(start.getDate() - 7);
          return createPreset(
            "lastWeek",
            zh ? "上周" : "Last week",
            start,
            weekStart,
          );
        },
      ],
      [
        "30d",
        zh ? "30天" : "30 days",
        () => relativeRange("30d", zh ? "30天" : "30 days", 2592000000),
      ],
      [
        "thisMonth",
        zh ? "本月" : "This month",
        () =>
          createPreset(
            "thisMonth",
            zh ? "本月" : "This month",
            monthStart,
            now,
          ),
      ],
      [
        "lastMonth",
        zh ? "上月" : "Last month",
        () => {
          const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          return createPreset(
            "lastMonth",
            zh ? "上月" : "Last month",
            start,
            monthStart,
          );
        },
      ],
      [
        "quarter",
        zh ? "本季度" : "This quarter",
        () =>
          createPreset(
            "quarter",
            zh ? "本季度" : "This quarter",
            quarterStart,
            now,
          ),
      ],
      [
        "year",
        zh ? "本年度" : "This year",
        () => createPreset("year", zh ? "本年度" : "This year", yearStart, now),
      ],
      ["custom", timeText.custom, () => draftTimeRange],
    ] as const;
  };
  const formatRange = (range: TimeRange) =>
    `${new Date(range.from).toLocaleString(effectiveSettings.language, { hour12: false })} ~ ${new Date(range.to).toLocaleString(effectiveSettings.language, { hour12: false })}`;
  /** Rounds a range to exact minute boundaries when requested by the user. */
  function roundTimeRange(range: TimeRange) {
    const from = new Date(range.from);
    const to = new Date(range.to);
    from.setSeconds(0, 0);
    to.setSeconds(0, 0);
    return { ...range, from: iso(from), to: iso(to) };
  }
  /** Validates, persists in local history, and queries a selected time range. */
  function commitTimeRange(range: TimeRange, close = true, round = exactTime) {
    const next = round ? roundTimeRange(range) : range;
    setDraftTimeRange(next);
    if (new Date(next.from) > new Date(next.to)) return;
    setTimeRange(next);
    setTimeHistory((history) =>
      [
        next,
        ...history.filter(
          (item) => item.from !== next.from || item.to !== next.to,
        ),
      ].slice(0, 5),
    );
    if (profileId && logstore)
      void executeQuery(profileId, logstore, query, next);
    if (close) setTimePickerOpen(false);
  }
  /** Converts a histogram index into its exact query interval. */
  function histogramBucketRange(index: number) {
    const bucketCount = histogram.counts.length;
    const start = new Date(timeRange.from).getTime();
    const end = new Date(timeRange.to).getTime();
    const bucketSize = (end - start) / bucketCount;
    return {
      from: new Date(start + bucketSize * index),
      to: new Date(
        index === bucketCount - 1 ? end : start + bucketSize * (index + 1),
      ),
    };
  }
  /** Drills into the time interval represented by one histogram bucket. */
  function selectHistogramBucket(index: number) {
    const range = histogramBucketRange(index);
    commitTimeRange(
      {
        key: "chart",
        label:
          effectiveSettings.language === "zh-CN"
            ? "图表区间"
            : "Chart interval",
        from: iso(range.from),
        to: iso(range.to),
      },
      false,
      false,
    );
  }
  const histogramTooltipRange =
    hoveredBucket === null ? null : histogramBucketRange(hoveredBucket);
  /** Opens the settings drawer with a reversible draft copy. */
  function openSettings() {
    setDraftSettings(settings);
    setSettingsOpen(true);
  }
  /** Persists the settings draft and applies it to the application. */
  async function savePreferences() {
    setSavingSettings(true);
    setError("");
    try {
      await SaveSettings(draftSettings);
      setSettings(draftSettings);
      setSettingsOpen(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <main className="shell">
      <section
        className={
          profileId
            ? logSidebarCollapsed
              ? "workspace sidebar-collapsed"
              : "workspace"
            : "workspace connection-only"
        }
      >
        {profileId > 0 ? (
          <aside className="sidebar">
            <div className="section-title">
              <span>{t.logstores}</span>
              <span className="count">{logstores.length}</span>
            </div>
            {logstores.length ? (
              <nav aria-label={t.logstores}>
                {logstores.map((x) => (
                  <button
                    key={x}
                    className={x === logstore ? "store active" : "store"}
                    onClick={() => selectLogstore(x)}
                  >
                    <span className="store-icon">▤</span>
                    {x}
                  </button>
                ))}
              </nav>
            ) : (
              <div className="empty">
                <span>⌁</span>
                <p>{t.emptyStore}</p>
              </div>
            )}
            <div className="sidebar-footer">
              <div
                className="config-switcher"
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node))
                    setConfigSwitcherOpen(false);
                }}
              >
                <button
                  type="button"
                  className={
                    configSwitcherOpen
                      ? "sidebar-action switch open"
                      : "sidebar-action switch"
                  }
                  onClick={() => setConfigSwitcherOpen((open) => !open)}
                  aria-haspopup="listbox"
                  aria-expanded={configSwitcherOpen}
                >
                  <span className="sidebar-action-icon">
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M4 6h11m0 0-3-3m3 3-3 3M16 14H5m0 0 3 3m-3-3 3-3" />
                    </svg>
                  </span>
                  <span>
                    <strong>
                      {effectiveSettings.language === "zh-CN"
                        ? "切换配置"
                        : "Switch profile"}
                    </strong>
                    <small>{activeProfile?.name?.trim() || t.saved}</small>
                  </span>
                  <b>⌃</b>
                </button>
                {configSwitcherOpen && (
                  <div className="config-switcher-menu" role="listbox">
                    {profiles.map((profile) => {
                      const adapter = adapters.find(
                        (item) => item.id === profile.adapterId,
                      );
                      return (
                        <button
                          type="button"
                          role="option"
                          aria-selected={profile.id === profileId}
                          className={profile.id === profileId ? "active" : ""}
                          key={profile.id}
                          onClick={() => void switchProfile(profile.id)}
                        >
                          <span className="profile-platform">
                            {adapterText(adapter).name.slice(0, 1) || "L"}
                          </span>
                          <span>
                            <strong>
                              {profile.name?.trim() ||
                                profile.project ||
                                profile.region ||
                                profile.endpoint ||
                                t.unnamedConnection}
                            </strong>
                            <small>{adapterText(adapter).name}</small>
                          </span>
                          {profile.id === profileId && <em>✓</em>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="sidebar-action exit"
                onClick={exitCurrentProfile}
              >
                <span className="sidebar-action-icon">
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8m4-3 3-3-3-3m3 3H7" />
                  </svg>
                </span>
                <span>
                  <strong>
                    {effectiveSettings.language === "zh-CN"
                      ? "退出当前配置"
                      : "Exit profile"}
                  </strong>
                </span>
              </button>
            </div>
          </aside>
        ) : null}
        <div className="content">
          {!profileId ? (
            <section className="connect-view">
              <div className="intro compact-intro">
                <h1>{t.connections}</h1>
              </div>
              <form className="connect-card" onSubmit={connect}>
                <div className="connection-tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={connectionMode === "saved"}
                    className={connectionMode === "saved" ? "active" : ""}
                    onClick={() => setConnectionMode("saved")}
                  >
                    {t.saved}
                    {profiles.length > 0 && <span>{profiles.length}</span>}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={connectionMode === "new"}
                    className={connectionMode === "new" ? "active" : ""}
                    onClick={() => setConnectionMode("new")}
                  >
                    ＋ {t.newConnection}
                  </button>
                </div>
                {connectionMode === "saved" ? (
                  <div className="saved-connection-pane">
                    {profiles.length ? (
                      <>
                        <div className="saved-profile-tools">
                          <label>
                            <svg viewBox="0 0 20 20" aria-hidden="true">
                              <circle cx="8.5" cy="8.5" r="5.25" />
                              <path d="m12.5 12.5 4 4" />
                            </svg>
                            <input
                              value={savedSearch}
                              onChange={(e) => {
                                setSavedSearch(e.target.value);
                                setSavedPage(1);
                              }}
                              placeholder={
                                effectiveSettings.language === "zh-CN"
                                  ? "搜索配置"
                                  : "Search profiles"
                              }
                            />
                            {savedSearch && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSavedSearch("");
                                  setSavedPage(1);
                                }}
                                aria-label={
                                  effectiveSettings.language === "zh-CN"
                                    ? "清除搜索"
                                    : "Clear search"
                                }
                              >
                                ×
                              </button>
                            )}
                          </label>
                          <span>{filteredProfiles.length}</span>
                        </div>
                        <div
                          className="saved-profile-list"
                          role="listbox"
                          aria-label={t.saved}
                        >
                          {visibleProfiles.map((profile) => {
                            const adapter = adapters.find(
                              (item) => item.id === profile.adapterId,
                            );
                            return (
                              <button
                                type="button"
                                role="option"
                                aria-selected={profile.id === savedProfileId}
                                className={
                                  profile.id === savedProfileId
                                    ? "selected"
                                    : ""
                                }
                                key={profile.id}
                                onClick={() => setSavedProfileId(profile.id)}
                              >
                                <span className="profile-platform">
                                  {adapterText(adapter).name.slice(0, 1) || "L"}
                                </span>
                                <span className="saved-profile-copy">
                                  <strong>
                                    {profile.name?.trim() ||
                                      profile.project ||
                                      profile.region ||
                                      profile.endpoint ||
                                      t.unnamedConnection}
                                  </strong>
                                  <small>
                                    {adapterText(adapter).name ||
                                      profile.adapterId}
                                  </small>
                                </span>
                                <span
                                  className="saved-profile-target"
                                  title={
                                    profile.project ||
                                    profile.region ||
                                    profile.endpoint ||
                                    t.unnamedConnection
                                  }
                                >
                                  {profile.project ||
                                    profile.region ||
                                    profile.endpoint ||
                                    t.unnamedConnection}
                                </span>
                              </button>
                            );
                          })}
                          {!visibleProfiles.length && (
                            <div className="saved-profile-empty">
                              {effectiveSettings.language === "zh-CN"
                                ? "没有匹配的配置"
                                : "No matching profiles"}
                            </div>
                          )}
                        </div>
                        {savedPageCount > 1 && (
                          <div className="saved-profile-pagination">
                            <button
                              type="button"
                              disabled={savedPage <= 1}
                              onClick={() =>
                                setSavedPage((page) => Math.max(1, page - 1))
                              }
                            >
                              ‹
                            </button>
                            <span>
                              {Math.min(savedPage, savedPageCount)} /{" "}
                              {savedPageCount}
                            </span>
                            <button
                              type="button"
                              disabled={savedPage >= savedPageCount}
                              onClick={() =>
                                setSavedPage((page) =>
                                  Math.min(savedPageCount, page + 1),
                                )
                              }
                            >
                              ›
                            </button>
                          </div>
                        )}
                        <button
                          type="button"
                          className="primary"
                          onClick={() => connectSavedProfile()}
                          disabled={busy || !savedProfileId}
                        >
                          {busy
                            ? t.connecting
                            : effectiveSettings.language === "zh-CN"
                              ? "连接"
                              : "Connect"}
                        </button>
                      </>
                    ) : (
                      <div className="no-saved">
                        <p>{t.noSaved}</p>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => setConnectionMode("new")}
                        >
                          {t.newConnection}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="form-grid">
                      <label className="wide">
                        {t.choose}
                        <select
                          value={form.adapterId}
                          onChange={(e) => {
                            const id = e.target.value;
                            setForm({
                              ...form,
                              adapterId: id,
                            });
                          }}
                        >
                          {adapters.map((a) => (
                            <option key={a.id} value={a.id} disabled={!a.ready}>
                              {adapterText(a).name}
                              {!a.ready ? ` · ${t.pending}` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {t.connectionAlias}
                        <input
                          value={form.name}
                          onChange={(e) =>
                            setForm({ ...form, name: e.target.value })
                          }
                          placeholder={t.aliasPlaceholder}
                          maxLength={80}
                          required
                        />
                      </label>
                      <label>
                        {t.endpoint}
                        <input
                          value={form.endpoint}
                          onChange={(e) =>
                            setForm({ ...form, endpoint: e.target.value })
                          }
                          placeholder={
                            form.adapterId === "tencent-cls"
                              ? "https://cls.tencentcloudapi.com"
                              : "https://cn-hangzhou.log.aliyuncs.com"
                          }
                        />
                      </label>
                      <label>
                        {form.adapterId === "tencent-cls"
                          ? t.secretId
                          : t.accessKey}
                        <input
                          value={form.accessKey}
                          onChange={(e) =>
                            setForm({ ...form, accessKey: e.target.value })
                          }
                          autoComplete="off"
                        />
                      </label>
                      <label>
                        {t.secretKey}
                        <input
                          type="password"
                          value={form.secretKey}
                          onChange={(e) =>
                            setForm({ ...form, secretKey: e.target.value })
                          }
                          autoComplete="new-password"
                        />
                      </label>
                      {form.adapterId !== "tencent-cls" && (
                        <label>
                          {t.project}
                          <input
                            value={form.project}
                            onChange={(e) =>
                              setForm({ ...form, project: e.target.value })
                            }
                            required={form.adapterId === "aliyun-sls"}
                          />
                        </label>
                      )}
                      {form.adapterId === "tencent-cls" && (
                        <label>
                          {t.region}
                          <input
                            value={form.region}
                            onChange={(e) =>
                              setForm({ ...form, region: e.target.value })
                            }
                            placeholder="ap-guangzhou"
                            required
                          />
                        </label>
                      )}
                    </div>
                    {error && (
                      <div className="alert" role="alert">
                        {error}
                      </div>
                    )}
                    <button
                      className="primary"
                      disabled={busy || !selected?.ready}
                    >
                      {busy
                        ? t.connecting
                        : effectiveSettings.language === "zh-CN"
                          ? "保存并连接"
                          : "Save & Connect"}
                    </button>
                  </>
                )}
                {connectionMode === "saved" && error && (
                  <div className="alert" role="alert">
                    {error}
                  </div>
                )}
              </form>
            </section>
          ) : (
            <section className="query-view">
              <div className="query-head">
                <div className="breadcrumb-line">
                  <button
                    type="button"
                    className={
                      logSidebarCollapsed
                        ? "log-sidebar-toggle collapsed"
                        : "log-sidebar-toggle"
                    }
                    onClick={() => setLogSidebarCollapsed((value) => !value)}
                    title={
                      effectiveSettings.language === "zh-CN"
                        ? logSidebarCollapsed
                          ? "展开日志库侧边栏"
                          : "收起日志库侧边栏"
                        : logSidebarCollapsed
                          ? "Expand logstore sidebar"
                          : "Collapse logstore sidebar"
                    }
                    aria-label={
                      effectiveSettings.language === "zh-CN"
                        ? logSidebarCollapsed
                          ? "展开日志库侧边栏"
                          : "收起日志库侧边栏"
                        : logSidebarCollapsed
                          ? "Expand logstore sidebar"
                          : "Collapse logstore sidebar"
                    }
                    aria-expanded={!logSidebarCollapsed}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <rect
                        x="2.75"
                        y="3.25"
                        width="14.5"
                        height="13.5"
                        rx="1"
                      />
                      <path d="M7.25 3.25v13.5M11.5 7 9 10l2.5 3" />
                    </svg>
                  </button>
                  <span className="breadcrumb">{t.logstores}</span>
                  <span className="breadcrumb-separator">/</span>
                  <h1 title={logstore}>{logstore}</h1>
                </div>
                <div className="time-picker" ref={timePickerRef}>
                  <button
                    className={timePickerOpen ? "time open" : "time"}
                    onClick={() => {
                      if (timePickerOpen) {
                        commitTimeRange(draftTimeRange, false);
                        setTimePickerOpen(false);
                        setCustomTimeOpen(false);
                      } else {
                        setDraftTimeRange(timeRange);
                        setTimePickerOpen(true);
                      }
                    }}
                    aria-haspopup="dialog"
                    aria-expanded={timePickerOpen}
                  >
                    <svg
                      className="time-icon"
                      viewBox="0 0 20 20"
                      aria-hidden="true"
                    >
                      <circle cx="10" cy="10" r="7.25" />
                      <path d="M10 5.75V10l3 1.75" />
                    </svg>
                    <span className="time-value">
                      {timeRange.key === "15m" ? t.recent : timeRange.label}
                    </span>
                    <svg
                      className="time-chevron"
                      viewBox="0 0 16 16"
                      aria-hidden="true"
                    >
                      <path d="m3.5 6 4.5 4.5L12.5 6" />
                    </svg>
                  </button>
                  {timePickerOpen && (
                    <section
                      className="time-popover"
                      role="dialog"
                      aria-label={timeText.select}
                    >
                      <div className="time-summary">
                        <span>{draftTimeRange.label}</span>
                        <strong>{formatRange(draftTimeRange)}</strong>
                        <svg
                          className="time-chevron open"
                          viewBox="0 0 16 16"
                          aria-hidden="true"
                        >
                          <path d="m3.5 6 4.5 4.5L12.5 6" />
                        </svg>
                      </div>
                      <div className="time-popover-head">
                        <strong>{timeText.select}</strong>
                        <label>
                          <input
                            type="checkbox"
                            checked={exactTime}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setExactTime(checked);
                              if (checked)
                                commitTimeRange(
                                  roundTimeRange(draftTimeRange),
                                  false,
                                  false,
                                );
                            }}
                          />
                          <span>{timeText.exact}</span>
                        </label>
                      </div>
                      {customTimeOpen && (
                        <div className="custom-time-fields">
                          <DateTimeField
                            label={timeText.from}
                            value={draftTimeRange.from}
                            locale={effectiveSettings.language}
                            onChange={(value) =>
                              setDraftTimeRange({
                                ...draftTimeRange,
                                key: "custom",
                                label: timeText.custom,
                                from: value,
                              })
                            }
                          />
                          <span>→</span>
                          <DateTimeField
                            label={timeText.to}
                            value={draftTimeRange.to}
                            locale={effectiveSettings.language}
                            onChange={(value) =>
                              setDraftTimeRange({
                                ...draftTimeRange,
                                key: "custom",
                                label: timeText.custom,
                                to: value,
                              })
                            }
                          />
                        </div>
                      )}
                      <div className="time-presets">
                        {timePresets().map(([key, label, make]) => (
                          <button
                            type="button"
                            key={key}
                            className={
                              draftTimeRange.key === key ? "selected" : ""
                            }
                            onClick={() => {
                              if (key === "custom") {
                                setCustomTimeOpen(true);
                              } else {
                                setCustomTimeOpen(false);
                                commitTimeRange(make());
                              }
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="time-history">
                        <button
                          type="button"
                          onClick={() => setHistoryOpen((open) => !open)}
                        >
                          {timeText.history}{" "}
                          <span>{historyOpen ? "⌄" : "›"}</span>
                        </button>
                        {historyOpen && (
                          <div>
                            {timeHistory.length ? (
                              timeHistory.map((item, index) => (
                                <button
                                  type="button"
                                  key={`${item.from}-${index}`}
                                  onClick={() => commitTimeRange(item)}
                                >
                                  <strong>{item.label}</strong>
                                  <small>{formatRange(item)}</small>
                                </button>
                              ))
                            ) : (
                              <small>—</small>
                            )}
                          </div>
                        )}
                      </div>
                    </section>
                  )}
                </div>
              </div>
              <section className="query-console">
                <div className="query-editor-area" ref={queryEditorRef}>
                  <div className="query-toolbar">
                    <button
                      type="button"
                      className={
                        queryFavorite
                          ? "query-tool favorite active"
                          : "query-tool favorite"
                      }
                      aria-label={queryText.favorite}
                      onClick={() => setQueryFavorite((value) => !value)}
                    >
                      ★
                    </button>
                    <span className="query-line" aria-hidden="true">
                      {query
                        .split("\n")
                        .slice(0, 5)
                        .map((_, index) => (
                          <b key={index}>{index + 1}</b>
                        ))}
                    </span>
                    <textarea
                      ref={queryTextareaRef}
                      rows={Math.min(5, Math.max(1, query.split("\n").length))}
                      value={query}
                      onFocus={() => void openQueryAssist()}
                      onClick={() => setSuggestionIndex(0)}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setSuggestionIndex(0);
                      }}
                      onKeyDown={handleQueryKeyDown}
                      placeholder={queryText.placeholder}
                      spellCheck={false}
                      aria-expanded={queryAssistOpen}
                    />
                    <button
                      type="button"
                      className="query-submit"
                      onClick={search}
                      disabled={busy}
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <circle cx="8.5" cy="8.5" r="5.25" />
                        <path d="m12.5 12.5 4 4" />
                      </svg>
                      {busy ? t.querying : queryText.run}
                    </button>
                  </div>
                  {queryAssistOpen && (
                    <section
                      className="query-assist"
                      aria-label={
                        effectiveSettings.language === "zh-CN"
                          ? "查询提示"
                          : "Query suggestions"
                      }
                    >
                      <div className="query-assist-section">
                        <header>
                          <strong>
                            {effectiveSettings.language === "zh-CN"
                              ? "智能提示"
                              : "Suggestions"}
                          </strong>
                          <span>
                            {effectiveSettings.language === "zh-CN"
                              ? "字段"
                              : "Fields"}
                          </span>
                        </header>
                        <div role="listbox">
                          {fieldSuggestions.map((field, index) => (
                            <button
                              type="button"
                              role="option"
                              aria-selected={index === suggestionIndex}
                              className={
                                index === suggestionIndex ? "selected" : ""
                              }
                              key={field}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => applySuggestion(field)}
                            >
                              <i>i</i>
                              <code>{field}</code>
                              <small>
                                {effectiveSettings.language === "zh-CN"
                                  ? "索引字段"
                                  : "Indexed field"}
                              </small>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="query-assist-section history">
                        <header>
                          <strong>
                            {effectiveSettings.language === "zh-CN"
                              ? "历史记录"
                              : "History"}
                          </strong>
                          <span>{queryHistory.length}</span>
                        </header>
                        <div>
                          {queryHistory.length ? (
                            queryHistory.slice(0, 8).map((item) => (
                              <button
                                type="button"
                                key={`${item.query}-${item.updatedAt}`}
                                onClick={() => runHistory(item)}
                              >
                                <i>◷</i>
                                <code>{item.query}</code>
                              </button>
                            ))
                          ) : (
                            <p>
                              {effectiveSettings.language === "zh-CN"
                                ? "暂无查询历史"
                                : "No query history"}
                            </p>
                          )}
                        </div>
                      </div>
                      <footer>
                        <span>
                          ↑↓{" "}
                          {effectiveSettings.language === "zh-CN"
                            ? "移动光标"
                            : "Navigate"}
                        </span>
                        <span>
                          Tab / Enter{" "}
                          {effectiveSettings.language === "zh-CN"
                            ? "确认结果"
                            : "Complete"}
                        </span>
                        <span>
                          Esc{" "}
                          {effectiveSettings.language === "zh-CN"
                            ? "退出提示"
                            : "Close"}
                        </span>
                      </footer>
                    </section>
                  )}
                </div>
                <div className="query-stats">
                  <strong>
                    {queryText.count}：
                    {result?.total.toLocaleString(effectiveSettings.language) ||
                      0}
                  </strong>
                  {result && <small>{result.tookMs} ms</small>}
                </div>
                <div className="query-histogram">
                  <div className="histogram-scale">
                    <span>{histogram.max}</span>
                    <span>0</span>
                  </div>
                  <div className="histogram-plot">
                    {histogram.counts.map((count, index) => (
                      <button
                        type="button"
                        className="histogram-bucket"
                        key={index}
                        onClick={() => selectHistogramBucket(index)}
                        onMouseEnter={() => setHoveredBucket(index)}
                        onMouseLeave={() => setHoveredBucket(null)}
                        onFocus={() => setHoveredBucket(index)}
                        onBlur={() => setHoveredBucket(null)}
                        aria-label={`${effectiveSettings.language === "zh-CN" ? "筛选时间区间" : "Filter time interval"} ${index + 1}, ${count}`}
                      >
                        <span
                          style={{
                            height: `${count ? Math.max(8, (count / histogram.max) * 100) : 0}%`,
                          }}
                        />
                        <small>{histogram.labels[index]}</small>
                      </button>
                    ))}
                    {hoveredBucket !== null && histogramTooltipRange && (
                      <div
                        className={`histogram-tooltip ${hoveredBucket < 3 ? "align-left" : hoveredBucket > 14 ? "align-right" : ""}`}
                        style={{
                          left: `${((hoveredBucket + 0.5) / histogram.counts.length) * 100}%`,
                        }}
                        role="tooltip"
                      >
                        <div>
                          <span>
                            {effectiveSettings.language === "zh-CN"
                              ? "起始时间"
                              : "Start"}
                          </span>
                          <strong>
                            {histogramTooltipRange.from.toLocaleString(
                              effectiveSettings.language,
                              { hour12: false },
                            )}
                          </strong>
                        </div>
                        <div>
                          <span>
                            {effectiveSettings.language === "zh-CN"
                              ? "结束时间"
                              : "End"}
                          </span>
                          <strong>
                            {histogramTooltipRange.to.toLocaleString(
                              effectiveSettings.language,
                              { hour12: false },
                            )}
                          </strong>
                        </div>
                        <div>
                          <span>
                            {effectiveSettings.language === "zh-CN"
                              ? "次数"
                              : "Count"}
                          </span>
                          <strong>
                            {histogram.counts[hoveredBucket].toLocaleString(
                              effectiveSettings.language,
                            )}
                          </strong>
                        </div>
                        <em>
                          {effectiveSettings.language === "zh-CN"
                            ? "查询结果精确"
                            : "Exact query result"}
                        </em>
                      </div>
                    )}
                  </div>
                </div>
              </section>
              {error && (
                <div className="alert" role="alert">
                  {error}
                </div>
              )}
              <LogResults
                entries={result?.entries || []}
                total={result?.total || 0}
                locale={effectiveSettings.language}
                page={currentPage}
                pageSize={pageSize}
                onPageChange={changePage}
                onPageSizeChange={changePageSize}
                onFilter={filterByValue}
              />
            </section>
          )}
        </div>
      </section>
      {settingsOpen && (
        <div
          className="settings-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSettingsOpen(false);
          }}
        >
          <section
            className="settings-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") setSettingsOpen(false);
            }}
          >
            <header>
              <h2 id="settings-title">{t.settingsTitle}</h2>
              <button
                className="close-button"
                onClick={() => setSettingsOpen(false)}
                aria-label={t.cancel}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="m5 5 10 10M15 5 5 15" />
                </svg>
              </button>
            </header>
            <div className="settings-body">
              <div className="setting-group">
                <label>{t.appearance}</label>
                <div className="segmented">
                  {(["system", "light", "dark"] as const).map((v) => (
                    <button
                      key={v}
                      className={draftSettings.theme === v ? "selected" : ""}
                      onClick={() =>
                        setDraftSettings({ ...draftSettings, theme: v })
                      }
                    >
                      {t[v]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="setting-group">
                <label>{t.language}</label>
                <div className="segmented two">
                  <button
                    className={
                      draftSettings.language === "zh-CN" ? "selected" : ""
                    }
                    onClick={() =>
                      setDraftSettings({ ...draftSettings, language: "zh-CN" })
                    }
                  >
                    {t.chinese}
                  </button>
                  <button
                    className={
                      draftSettings.language === "en-US" ? "selected" : ""
                    }
                    onClick={() =>
                      setDraftSettings({ ...draftSettings, language: "en-US" })
                    }
                  >
                    {t.english}
                  </button>
                </div>
              </div>
              <div className="setting-group">
                <label>{t.density}</label>
                <div className="segmented two">
                  <button
                    className={
                      draftSettings.density === "comfortable" ? "selected" : ""
                    }
                    onClick={() =>
                      setDraftSettings({
                        ...draftSettings,
                        density: "comfortable",
                      })
                    }
                  >
                    {t.comfortable}
                  </button>
                  <button
                    className={
                      draftSettings.density === "compact" ? "selected" : ""
                    }
                    onClick={() =>
                      setDraftSettings({ ...draftSettings, density: "compact" })
                    }
                  >
                    {t.compact}
                  </button>
                </div>
              </div>
            </div>
            <footer>
              <button
                className="secondary"
                onClick={() => setSettingsOpen(false)}
              >
                {t.cancel}
              </button>
              <button
                className="primary save-settings"
                onClick={savePreferences}
                disabled={savingSettings}
              >
                {savingSettings ? t.saving : t.save}
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
export default App;
