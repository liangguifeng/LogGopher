/** Owns the desktop UI state machine and its Wails application boundary calls. */
import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "../styles/app.css";
import "../styles/settings.css";
import "../styles/workspace-scale.css";
import "../styles/functional-theme.css";
import "../styles/observatory-theme.css";
import {
  Bootstrap,
  Connect,
  ConnectSaved,
  DeleteProfile,
  GetProfileCredentials,
  Query,
  QueryHistory as LoadQueryHistory,
  SaveSettings,
  UpdateProfile,
} from "../../wailsjs/go/main/App";
import { EventsOn } from "../../wailsjs/runtime/runtime";
import DateTimeField from "../components/date-time-picker/DateTimeField";
import { appendSLSResultFilter } from "../features/aliyun-sls/query";
import LogResults from "../features/log-results/LogResults";
import LogstoreTree from "../features/log-navigation/LogstoreTree";

/** Adapter metadata rendered by the connection workflow. */
type Adapter = { id: string; name: string; description: string; ready: boolean };
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
  messageField?: string;
  fields: Record<string, string>;
};
/** Exact provider-side count for one histogram interval. */
type HistogramBucket = { from: string; to: string; count: number };
/** One paginated query response. */
type Result = {
  tookMs: number;
  total: number;
  entries: Entry[];
  histogram: HistogramBucket[];
  indexedFields: string[];
  fullTextIndex: boolean;
  effectiveQuery?: string;
};
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
/** Provider-level parent and its available logstores. */
type LogGroup = { name: string; logstores: string[] };

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
    loadingConfiguration: "正在加载配置…",
    recent: "最近 15 分钟",
    querying: "查询中…",
    settingsTitle: "偏好设置",
    back: "返回",
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
    editConnection: "修改配置",
    deleteConnection: "删除配置",
    deleteTitle: "删除连接配置",
    deleteWarning: "配置、查询历史和已保存凭证将被永久删除。",
    showSecret: "显示 Secret Key",
    hideSecret: "隐藏 Secret Key",
    saveChanges: "保存修改",
    savingChanges: "保存中…",
    confirmDelete: "确认删除",
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
    loadingConfiguration: "Loading profile…",
    recent: "Last 15 minutes",
    querying: "Searching…",
    settingsTitle: "Preferences",
    back: "Back",
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
    editConnection: "Edit profile",
    deleteConnection: "Delete profile",
    deleteTitle: "Delete connection profile",
    deleteWarning: "The profile, query history, and saved credentials will be permanently deleted.",
    showSecret: "Show Secret Key",
    hideSecret: "Hide Secret Key",
    saveChanges: "Save changes",
    savingChanges: "Saving…",
    confirmDelete: "Delete profile",
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
  const [editingProfileId, setEditingProfileId] = useState(0);
  const [deleteCandidate, setDeleteCandidate] = useState<Profile | null>(null);
  const [adapterPickerOpen, setAdapterPickerOpen] = useState(false);
  const [configSwitcherOpen, setConfigSwitcherOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [secretVisible, setSecretVisible] = useState(false);
  const [profileId, setProfileId] = useState(0);
  const [logGroups, setLogGroups] = useState<LogGroup[]>([]);
  const [project, setProject] = useState("");
  const [logstore, setLogstore] = useState("");
  const [logSidebarCollapsed, setLogSidebarCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [busy, setBusy] = useState(false);
  const [connectionPending, setConnectionPending] = useState<
    "saved" | "form" | "edit" | null
  >(null);
  const [pendingProfileId, setPendingProfileId] = useState(0);
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
  const adapterPickerRef = useRef<HTMLDivElement>(null);

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
  useEffect(() => {
    if (!adapterPickerOpen) return;
    const close = (event: PointerEvent) => {
      if (!adapterPickerRef.current?.contains(event.target as Node))
        setAdapterPickerOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [adapterPickerOpen]);
  const selected = useMemo(
    () => adapters.find((a) => a.id === form.adapterId),
    [adapters, form.adapterId],
  );
  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === profileId),
    [profiles, profileId],
  );
  const activeAdapter = useMemo(
    () =>
      adapters.find(
        (adapter) => adapter.id === (activeProfile?.adapterId || form.adapterId),
      ),
    [activeProfile, adapters, form.adapterId],
  );
  const selectedSavedProfile = useMemo(
    () => profiles.find((profile) => profile.id === savedProfileId),
    [profiles, savedProfileId],
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
    const start = new Date(timeRange.from).getTime();
    const end = new Date(timeRange.to).getTime();
    const span = Math.max(1, end - start);
    const buckets = result?.histogram?.length
      ? result.histogram
      : Array.from({ length: 18 }, (_, index) => ({
          from: new Date(start + (span * index) / 18).toISOString(),
          to: new Date(start + (span * (index + 1)) / 18).toISOString(),
          count: 0,
        }));
    const counts = buckets.map((bucket) => bucket.count);
    const max = Math.max(1, ...counts);
    const labels = buckets.map((bucket, index) => {
      if (index % 3 !== 0 && index !== buckets.length - 1) return "";
      return axisLabel(
        new Date(bucket.from),
        span,
        effectiveSettings.language,
      );
    });
    return { buckets, counts, max, labels };
  }, [result, timeRange, effectiveSettings.language]);
  const fieldSuggestions = useMemo(() => {
    const aliyun = activeAdapter?.id === "aliyun-sls";
    const paths = new Set<string>(aliyun ? result?.indexedFields || [] : ["message"]);
    if (!aliyun) {
      for (const entry of result?.entries || []) {
        for (const [field, raw] of Object.entries(entry.fields)) {
          paths.add(field);
          try {
            collectFieldPaths(JSON.parse(raw), field, paths);
          } catch {}
        }
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
  }, [activeAdapter?.id, result, query]);

  /** Saves a new connection or updates the selected saved profile. */
  async function connect(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setConnectionPending("form");
    setError("");
    try {
      if (editingProfileId) {
        await UpdateProfile(editingProfileId, {
          ...form,
          name: form.name.trim(),
        });
        const data: any = await Bootstrap();
        setProfiles(data.profiles || []);
        setSavedProfileId(editingProfileId);
        setEditingProfileId(0);
        setForm({ ...emptyForm });
        setSecretVisible(false);
        setConnectionMode("saved");
        return;
      }
      const s: any = await Connect({ ...form, name: form.name.trim() });
      await applySession(s);
      const data: any = await Bootstrap();
      setProfiles(data.profiles || []);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setConnectionPending(null);
    }
  }
  /** Loads saved credentials and opens the selected profile in the connection editor. */
  async function editSavedProfile(profile: Profile) {
    setBusy(true);
    setConnectionPending("edit");
    setPendingProfileId(profile.id);
    setError("");
    try {
      const credentials = await GetProfileCredentials(profile.id);
      setEditingProfileId(profile.id);
      setForm({
        adapterId: profile.adapterId,
        name: profile.name,
        endpoint: profile.endpoint,
        accessKey: credentials.accessKey || "",
        secretKey: credentials.secretKey || "",
        project: profile.project,
        region: profile.region,
      });
      setSecretVisible(false);
      setConnectionMode("new");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setConnectionPending(null);
      setPendingProfileId(0);
    }
  }
  /** Deletes the confirmed profile and refreshes the saved connection list. */
  async function deleteSavedProfile() {
    if (!deleteCandidate) return;
    setBusy(true);
    setError("");
    try {
      await DeleteProfile(deleteCandidate.id);
      const data: any = await Bootstrap();
      const remaining: Profile[] = data.profiles || [];
      setProfiles(remaining);
      setSavedPage(1);
      setSavedProfileId((current) =>
        current === deleteCandidate.id ? remaining[0]?.id || 0 : current,
      );
      if (editingProfileId === deleteCandidate.id) {
        setEditingProfileId(0);
        setForm({ ...emptyForm });
        setSecretVisible(false);
      }
      if (profileId === deleteCandidate.id) resetWorkspace();
      if (!remaining.length) setConnectionMode("new");
      setDeleteCandidate(null);
    } catch (e) {
      setError(String(e));
      setDeleteCandidate(null);
    } finally {
      setBusy(false);
    }
  }
  /** Resets the form so it creates a new profile instead of editing one. */
  function startNewConnection() {
    setEditingProfileId(0);
    setForm({ ...emptyForm });
    setSecretVisible(false);
    setError("");
    setConnectionMode("new");
  }
  /** Restores credentials and connects a previously saved profile. */
  async function connectSavedProfile(id = savedProfileId) {
    if (!id) return;
    setBusy(true);
    setConnectionPending("saved");
    setError("");
    try {
      await applySession((await ConnectSaved(id)) as any);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setConnectionPending(null);
    }
  }
  /** Applies a backend session and eagerly loads its first logstore. */
  async function applySession(session: { profileId: number; groups: LogGroup[] }) {
    const groups = session.groups || [];
    const firstGroup = groups.find((group) => group.logstores.length > 0);
    const firstProject = firstGroup?.name || "";
    const firstStore = firstGroup?.logstores[0] || "";
    setProfileId(session.profileId);
    setLogGroups(groups);
    setProject(firstProject);
    setLogstore(firstStore);
    setLogSidebarCollapsed(false);
    setQuery("");
    setResult(null);
    if (firstStore)
      await executeQuery(session.profileId, firstProject, firstStore, "", timeRange);
  }
  /** Clears connection-specific UI state and returns to the connection home. */
  function resetWorkspace() {
    setProfileId(0);
    setLogGroups([]);
    setProject("");
    setLogstore("");
    setResult(null);
    setCurrentPage(1);
    setError("");
  }
  /** Executes a paginated query while keeping loading and error state consistent. */
  async function executeQuery(
    targetProfileID: number,
    targetProject: string,
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
      const nextResult = (await Query({
          profileId: targetProfileID,
          group: targetProject,
          logstore: targetLogstore,
          query: queryValue,
          from: range.from,
          to: range.to,
          page: targetPage,
          limit: targetPageSize,
        })) as Result;
      setResult(nextResult);
      if (nextResult.effectiveQuery && nextResult.effectiveQuery !== queryValue)
        setQuery(nextResult.effectiveQuery);
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
    await executeQuery(profileId, project, logstore, query, timeRange);
  }
  /** Opens query completion and loads persisted history for the active scope. */
  async function openQueryAssist() {
    setQueryAssistOpen(true);
    setSuggestionIndex(0);
    try {
      setQueryHistory(
        (await LoadQueryHistory(profileId, project, logstore)) as QueryHistoryItem[],
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
    void executeQuery(profileId, project, logstore, item.query, timeRange);
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
  function filterByValue(
    field: string | undefined,
    _displayField: string,
    value: unknown,
    exclude: boolean,
  ) {
    if (activeAdapter?.id === "aliyun-sls") {
      const next = appendSLSResultFilter(query, field, value, exclude);
      setQuery(next);
      void executeQuery(profileId, project, logstore, next, timeRange);
      return;
    }
    const encoded =
      typeof value === "string"
        ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
        : String(value);
    // Other providers retain the existing neutral filter expression format.
    const clause = field ? `${field}:${encoded}` : encoded;
    const next = [query.trim(), exclude ? `NOT ${clause}` : clause]
      .filter(Boolean)
      .join(" AND ");
    setQuery(next);
    void executeQuery(profileId, project, logstore, next, timeRange);
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
      project,
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
    void executeQuery(profileId, project, logstore, query, timeRange, 1, nextPageSize);
  }
  /** Selects a logstore and refreshes its result set. */
  const selectLogstore = useCallback((nextProject: string, nextLogstore: string) => {
    setProject(nextProject);
    setLogstore(nextLogstore);
    setQuery("");
    setQueryAssistOpen(false);
    setQueryFavorite(false);
    setResult(null);
    void executeQuery(profileId, nextProject, nextLogstore, "", timeRange);
  }, [pageSize, profileId, timeRange]);
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
    setSecretVisible(false);
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
      void executeQuery(profileId, project, logstore, query, next);
    if (close) setTimePickerOpen(false);
  }
  /** Converts a histogram index into its exact query interval. */
  function histogramBucketRange(index: number) {
    const bucket = histogram.buckets[index];
    return {
      from: new Date(bucket.from),
      to: new Date(bucket.to),
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
  /** Opens the standalone settings page with a reversible draft copy. */
  function openSettings() {
    setDraftSettings(settings);
    setError("");
    setSettingsOpen(true);
  }
  /** Returns to the previous workspace and discards unsaved preference changes. */
  function closeSettings() {
    setDraftSettings(settings);
    setError("");
    setSettingsOpen(false);
  }
  /** Persists the settings draft and applies it to the application. */
  async function savePreferences() {
    setSavingSettings(true);
    setError("");
    try {
      await SaveSettings(draftSettings);
      setSettings(draftSettings);
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <main className={settingsOpen ? "shell settings-view-active" : "shell"}>
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
          <aside className="sidebar log-navigation">
            <header className="log-sidebar-heading">
              <span>
                <small>
                  {effectiveSettings.language === "zh-CN"
                    ? "日志资源"
                    : "LOG RESOURCES"}
                </small>
                <strong>{t.logstores}</strong>
              </span>
              <span className="count">
                {logGroups.reduce((total, group) => total + group.logstores.length, 0)}
              </span>
            </header>
            {logGroups.length ? (
              <LogstoreTree
                key={profileId}
                groups={logGroups}
                activeGroup={project}
                activeLogstore={logstore}
                label={t.logstores}
                onSelect={selectLogstore}
              />
            ) : (
              <div className="empty">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 5.5h16v13H4zM7 9h10M7 12h10M7 15h6" />
                </svg>
                <p>{t.emptyStore}</p>
              </div>
            )}
            <div className="sidebar-footer">
              <div className="sidebar-profile" aria-label={activeProfile?.name || t.saved}>
                <span className="sidebar-profile-mark" aria-hidden="true">
                  {adapterText(activeAdapter).name.slice(0, 1) || "L"}
                </span>
                <span>
                  <strong>
                    {activeProfile?.name?.trim() ||
                      form.name.trim() ||
                      project ||
                      t.unnamedConnection}
                  </strong>
                  <small>{adapterText(activeAdapter).name}</small>
                </span>
              </div>
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
                  <svg className="sidebar-action-icon" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M4 6h11m0 0-3-3m3 3-3 3M16 14H5m0 0 3 3m-3-3 3-3" />
                  </svg>
                  <span>
                    <strong>
                      {effectiveSettings.language === "zh-CN"
                        ? "切换配置"
                        : "Switch profile"}
                    </strong>
                  </span>
                  <svg className="sidebar-action-chevron" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m4 10 4-4 4 4" />
                  </svg>
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
                          {profile.id === profileId && (
                            <svg className="config-active-check" viewBox="0 0 16 16" aria-hidden="true">
                              <path d="m3.5 8 3 3 6-6" />
                            </svg>
                          )}
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
                <svg className="sidebar-action-icon" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8m4-3 3-3-3-3m3 3H7" />
                </svg>
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
            <section className="connect-view connection-manager">
              <header className="connection-manager-header">
                <span className="connection-manager-mark" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M5 6.5h9M5 11h7M5 15.5h5" />
                    <circle cx="16.5" cy="15.5" r="3.5" />
                    <path d="m19 18 2 2" />
                  </svg>
                </span>
                <span className="connection-manager-copy">
                  <h1>{t.connections}</h1>
                  <small>
                    {effectiveSettings.language === "zh-CN"
                      ? "管理并连接多云日志平台"
                      : "Manage and connect cloud log platforms"}
                  </small>
                </span>
                <button
                  type="button"
                  className="connection-settings-button"
                  onClick={openSettings}
                  aria-label={t.settingsTitle}
                  title={t.settingsTitle}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M8.6 2.5h2.8l.5 1.9c.5.2 1 .5 1.4.8l1.9-.6 1.4 2.4-1.4 1.3c.1.6.1 1.1 0 1.7l1.4 1.3-1.4 2.4-1.9-.6c-.4.4-.9.6-1.4.8l-.5 1.9H8.6l-.5-1.9c-.5-.2-1-.5-1.4-.8l-1.9.6-1.4-2.4L4.8 10a7.2 7.2 0 0 1 0-1.7L3.4 7l1.4-2.4 1.9.6c.4-.4.9-.6 1.4-.8l.5-1.9Z" />
                    <circle cx="10" cy="9.15" r="2.25" />
                  </svg>
                  <span>{t.settingsTitle}</span>
                </button>
              </header>
              <form
                className="connect-card connection-workbench"
                onSubmit={connect}
              >
                <aside className="connection-navigation">
                  <strong>
                    {effectiveSettings.language === "zh-CN"
                      ? "连接工作台"
                      : "Connection workspace"}
                  </strong>
                  <div className="connection-tabs" role="tablist">
                  <button
                    id="connection-tab-saved"
                    type="button"
                    role="tab"
                    aria-controls="connection-panel"
                    aria-selected={connectionMode === "saved"}
                    className={connectionMode === "saved" ? "active" : ""}
                    onClick={() => {
                      setEditingProfileId(0);
                      setForm({ ...emptyForm });
                      setError("");
                      setConnectionMode("saved");
                    }}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M3.5 5.5h13v3h-13zM3.5 11.5h13v3h-13z" />
                      <path d="M6 7h.1M6 13h.1" />
                    </svg>
                    {t.saved}
                  </button>
                  <button
                    id="connection-tab-new"
                    type="button"
                    role="tab"
                    aria-controls="connection-panel"
                    aria-selected={connectionMode === "new"}
                    className={connectionMode === "new" ? "active" : ""}
                    onClick={startNewConnection}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M10 4v12M4 10h12" />
                    </svg>
                    {editingProfileId ? t.editConnection : t.newConnection}
                  </button>
                  </div>
                </aside>
                <section
                  id="connection-panel"
                  className="connection-pane"
                  role="tabpanel"
                  aria-labelledby={
                    connectionMode === "saved"
                      ? "connection-tab-saved"
                      : "connection-tab-new"
                  }
                >
                  <header className="connection-pane-header">
                    <h2>
                      {connectionMode === "saved"
                        ? t.saved
                        : editingProfileId
                          ? t.editConnection
                          : t.newConnection}
                    </h2>
                    <p>
                      {connectionMode === "saved"
                        ? effectiveSettings.language === "zh-CN"
                          ? "选择一个配置并进入日志工作区"
                          : "Select a profile to enter the log workspace"
                        : effectiveSettings.language === "zh-CN"
                          ? "填写平台凭证并保存连接"
                          : "Enter platform credentials and save the connection"}
                    </p>
                  </header>
                  <div className="connection-pane-body">
                {connectionMode === "saved" ? (
                  <div className="saved-connection-pane">
                    {profiles.length ? (
                      <>
                        <div className="saved-profile-workbench">
                          <section className="saved-profile-browser">
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
                        </div>
                        <div
                          className="saved-profile-list"
                          role="list"
                          aria-label={t.saved}
                        >
                          {visibleProfiles.map((profile) => {
                            const adapter = adapters.find(
                              (item) => item.id === profile.adapterId,
                            );
                            const profileLabel =
                              profile.name?.trim() ||
                              profile.project ||
                              profile.region ||
                              profile.endpoint ||
                              t.unnamedConnection;
                            return (
                              <div
                                role="listitem"
                                className={
                                  profile.id === savedProfileId
                                    ? "saved-profile-row selected"
                                    : "saved-profile-row"
                                }
                                key={profile.id}
                              >
                                <button
                                  type="button"
                                  className="saved-profile-main"
                                  aria-pressed={profile.id === savedProfileId}
                                  onClick={() => setSavedProfileId(profile.id)}
                                >
                                <span className="profile-platform">
                                  {adapterText(adapter).name.slice(0, 1) || "L"}
                                </span>
                                <span className="saved-profile-copy">
                                  <strong>{profileLabel}</strong>
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
                                <span className="saved-profile-actions">
                                  <button
                                    type="button"
                                    onClick={() => editSavedProfile(profile)}
                                    disabled={busy}
                                    aria-label={
                                      connectionPending === "edit" &&
                                      pendingProfileId === profile.id
                                        ? `${t.loadingConfiguration} ${profileLabel}`
                                        : `${t.editConnection} ${profileLabel}`
                                    }
                                    title={
                                      connectionPending === "edit" &&
                                      pendingProfileId === profile.id
                                        ? t.loadingConfiguration
                                        : t.editConnection
                                    }
                                  >
                                    {connectionPending === "edit" &&
                                    pendingProfileId === profile.id ? (
                                      <span className="button-spinner compact" aria-hidden="true" />
                                    ) : (
                                      <svg viewBox="0 0 20 20" aria-hidden="true">
                                        <path d="m4 14.8-.5 2.2 2.2-.5L15.9 6.3l-1.7-1.7Z" />
                                        <path d="m12.9 5.9 1.7 1.7" />
                                      </svg>
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setDeleteCandidate(profile)}
                                    aria-label={`${t.deleteConnection} ${profileLabel}`}
                                    title={t.deleteConnection}
                                  >
                                    <svg viewBox="0 0 20 20" aria-hidden="true">
                                      <path d="M4.5 6.5h11M8 3.5h4l1 2H7l1-2Zm-2 3 .7 10h6.6l.7-10M8.5 9v4.5M11.5 9v4.5" />
                                    </svg>
                                  </button>
                                </span>
                              </div>
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
                          </section>
                          <aside className="saved-profile-inspector">
                            {selectedSavedProfile ? (
                              <>
                                <span className="profile-platform" aria-hidden="true">
                                  {adapterText(
                                    adapters.find(
                                      (item) =>
                                        item.id === selectedSavedProfile.adapterId,
                                    ),
                                  ).name.slice(0, 1) || "L"}
                                </span>
                                <div className="saved-profile-identity">
                                  <strong>
                                    {selectedSavedProfile.name?.trim() ||
                                      selectedSavedProfile.project ||
                                      selectedSavedProfile.region ||
                                      selectedSavedProfile.endpoint ||
                                      t.unnamedConnection}
                                  </strong>
                                  <small>
                                    {adapterText(
                                      adapters.find(
                                        (item) =>
                                          item.id === selectedSavedProfile.adapterId,
                                      ),
                                    ).name || selectedSavedProfile.adapterId}
                                  </small>
                                </div>
                                <dl>
                                  <div>
                                    <dt>{t.endpoint}</dt>
                                    <dd title={selectedSavedProfile.endpoint}>
                                      {selectedSavedProfile.endpoint || "—"}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>
                                      {selectedSavedProfile.region
                                        ? t.region
                                        : effectiveSettings.language === "zh-CN"
                                          ? "项目"
                                          : "Project"}
                                    </dt>
                                    <dd>
                                      {selectedSavedProfile.region ||
                                        selectedSavedProfile.project ||
                                        (effectiveSettings.language === "zh-CN"
                                          ? "自动发现"
                                          : "Auto discovery")}
                                    </dd>
                                  </div>
                                </dl>
                                <button
                                  type="button"
                                  className="primary"
                                  onClick={() => connectSavedProfile()}
                                  disabled={busy || !savedProfileId}
                                >
                                  {connectionPending === "saved" && (
                                    <span className="button-spinner" aria-hidden="true" />
                                  )}
                                  <span>
                                    {connectionPending === "saved"
                                      ? t.connecting
                                      : effectiveSettings.language === "zh-CN"
                                        ? "连接"
                                        : "Connect"}
                                  </span>
                                </button>
                              </>
                            ) : (
                              <p className="saved-profile-inspector-empty">
                                {effectiveSettings.language === "zh-CN"
                                  ? "请选择一个连接配置"
                                  : "Select a connection profile"}
                              </p>
                            )}
                          </aside>
                        </div>
                      </>
                    ) : (
                      <div className="no-saved">
                        <p>{t.noSaved}</p>
                        <button
                          type="button"
                          className="secondary"
                          onClick={startNewConnection}
                        >
                          {t.newConnection}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="form-grid">
                      <div className="wide adapter-field" ref={adapterPickerRef}>
                        <span className="field-label">{t.choose}</span>
                        <button
                          type="button"
                          className={adapterPickerOpen ? "adapter-trigger open" : "adapter-trigger"}
                          onClick={() => setAdapterPickerOpen((open) => !open)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") setAdapterPickerOpen(false);
                          }}
                          aria-haspopup="listbox"
                          aria-expanded={adapterPickerOpen}
                        >
                          <span className="adapter-symbol" aria-hidden="true">
                            <svg viewBox="0 0 20 20">
                              <path d="M6.2 15.2h8a3.3 3.3 0 0 0 .5-6.6A5 5 0 0 0 5.1 7a4.1 4.1 0 0 0 1.1 8.2Z" />
                            </svg>
                          </span>
                          <span className="adapter-trigger-copy">
                            <strong>{adapterText(selected).name}</strong>
                            <small>{selected?.description || selected?.id}</small>
                          </span>
                          <svg className="adapter-arrow" viewBox="0 0 16 16" aria-hidden="true">
                            <path d="m4 6 4 4 4-4" />
                          </svg>
                        </button>
                        {adapterPickerOpen && (
                          <div className="adapter-options" role="listbox" aria-label={t.choose}>
                            {adapters.map((adapter) => (
                              <button
                                type="button"
                                role="option"
                                aria-selected={adapter.id === form.adapterId}
                                className={adapter.id === form.adapterId ? "selected" : ""}
                                disabled={!adapter.ready}
                                key={adapter.id}
                                onClick={() => {
                                  setForm({ ...form, adapterId: adapter.id });
                                  setAdapterPickerOpen(false);
                                }}
                              >
                                <span className="adapter-symbol" aria-hidden="true">
                                  <svg viewBox="0 0 20 20">
                                    <path d="M6.2 15.2h8a3.3 3.3 0 0 0 .5-6.6A5 5 0 0 0 5.1 7a4.1 4.1 0 0 0 1.1 8.2Z" />
                                  </svg>
                                </span>
                                <span>
                                  <strong>{adapterText(adapter).name}</strong>
                                  <small>{adapter.description || adapter.id}</small>
                                </span>
                                {!adapter.ready && <em>{t.pending}</em>}
                                {adapter.id === form.adapterId && adapter.ready && (
                                  <svg className="adapter-check" viewBox="0 0 16 16" aria-hidden="true">
                                    <path d="m3.5 8 3 3 6-6" />
                                  </svg>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
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
                              : form.adapterId === "aws-cloudwatch"
                                ? "https://logs.us-east-1.amazonaws.com"
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
                          aria-label={
                            form.adapterId === "tencent-cls"
                              ? t.secretId
                              : t.accessKey
                          }
                        />
                      </label>
                      <label>
                        {t.secretKey}
                        <span className="credential-input">
                          <input
                            type={secretVisible ? "text" : "password"}
                            value={form.secretKey}
                            onChange={(e) =>
                              setForm({ ...form, secretKey: e.target.value })
                            }
                            autoComplete={
                              editingProfileId
                                ? "current-password"
                                : "new-password"
                            }
                            aria-label={t.secretKey}
                          />
                          <button
                            type="button"
                            className="credential-visibility"
                            onClick={() => setSecretVisible((visible) => !visible)}
                            aria-label={
                              secretVisible ? t.hideSecret : t.showSecret
                            }
                            aria-pressed={secretVisible}
                            title={secretVisible ? t.hideSecret : t.showSecret}
                          >
                            {secretVisible ? (
                              <svg viewBox="0 0 20 20" aria-hidden="true">
                                <path d="M2.5 3.2 17.5 16.8M8.2 6.2A5.7 5.7 0 0 1 10 5.9c4 0 7 4.1 7 4.1a12.7 12.7 0 0 1-2.2 2.4M11.8 13.8a5.7 5.7 0 0 1-1.8.3c-4 0-7-4.1-7-4.1a12.8 12.8 0 0 1 2.2-2.4" />
                              </svg>
                            ) : (
                              <svg viewBox="0 0 20 20" aria-hidden="true">
                                <path d="M3 10s3-4.1 7-4.1S17 10 17 10s-3 4.1-7 4.1S3 10 3 10Z" />
                                <circle cx="10" cy="10" r="2.1" />
                              </svg>
                            )}
                          </button>
                        </span>
                      </label>
                      {(form.adapterId === "tencent-cls" ||
                        form.adapterId === "aws-cloudwatch") && (
                        <label>
                          {t.region}
                          <input
                            value={form.region}
                            onChange={(e) =>
                              setForm({ ...form, region: e.target.value })
                            }
                            placeholder={
                              form.adapterId === "aws-cloudwatch"
                                ? "us-east-1"
                                : "ap-guangzhou"
                            }
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
                      {connectionPending === "form" && (
                        <span className="button-spinner" aria-hidden="true" />
                      )}
                      <span>
                        {connectionPending === "form"
                          ? editingProfileId
                            ? t.savingChanges
                            : t.connecting
                          : editingProfileId
                            ? t.saveChanges
                            : effectiveSettings.language === "zh-CN"
                              ? "保存并连接"
                              : "Save & Connect"}
                      </span>
                    </button>
                  </>
                )}
                {connectionMode === "saved" && error && (
                  <div className="alert" role="alert">
                    {error}
                  </div>
                )}
                  </div>
                {deleteCandidate && (
                  <div className="profile-delete-backdrop" role="presentation">
                    <div
                      className="profile-delete-dialog"
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="profile-delete-title"
                    >
                      <h2 id="profile-delete-title">{t.deleteTitle}</h2>
                      <strong>
                        {deleteCandidate.name?.trim() ||
                          deleteCandidate.endpoint ||
                          t.unnamedConnection}
                      </strong>
                      <p>{t.deleteWarning}</p>
                      <footer>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => setDeleteCandidate(null)}
                          disabled={busy}
                        >
                          {t.cancel}
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => void deleteSavedProfile()}
                          disabled={busy}
                        >
                          {t.confirmDelete}
                        </button>
                      </footer>
                    </div>
                  </div>
                )}
                </section>
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
                  <span className="breadcrumb-value" title={project}>{project}</span>
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
                          <i className="time-exact-checkbox" aria-hidden="true">
                            <svg viewBox="0 0 16 16">
                              <path d="m3.5 8 3 3 6-6" />
                            </svg>
                          </i>
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
                  <div
                    className="histogram-plot"
                    style={{
                      gridTemplateColumns: `repeat(${histogram.counts.length}, minmax(0, 1fr))`,
                    }}
                  >
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
                        className={`histogram-tooltip ${hoveredBucket < 3 ? "align-left" : hoveredBucket >= histogram.counts.length - 3 ? "align-right" : ""}`}
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
                scopeKey={`${profileId}:${project}:${logstore}`}
                entries={result?.entries || []}
                total={result?.total || 0}
                locale={effectiveSettings.language}
                page={currentPage}
                pageSize={pageSize}
                onPageChange={changePage}
                onPageSizeChange={changePageSize}
                onFilter={filterByValue}
                filterableFields={
                  activeAdapter?.id === "aliyun-sls"
                    ? result?.indexedFields || []
                    : undefined
                }
              />
            </section>
          )}
        </div>
      </section>
      {settingsOpen && (
        <section className="settings-page" aria-labelledby="settings-title">
          <header className="settings-page-header">
            <button
              type="button"
              className="settings-back-button"
              onClick={closeSettings}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="m12.5 4.5-5.5 5.5 5.5 5.5M7 10h10" />
              </svg>
              <span>{t.back}</span>
            </button>
            <div>
              <h1 id="settings-title">{t.settingsTitle}</h1>
              <small>
                {effectiveSettings.language === "zh-CN"
                  ? "自定义应用的外观、语言与显示密度"
                  : "Customize appearance, language, and display density"}
              </small>
            </div>
          </header>
          <div className="settings-page-body">
            <section className="settings-page-content">
              <header className="settings-section-header">
                <div>
                  <h2>
                    {effectiveSettings.language === "zh-CN"
                      ? "界面与体验"
                      : "Interface and experience"}
                  </h2>
                  <p>
                    {effectiveSettings.language === "zh-CN"
                      ? "调整工作区的视觉呈现，修改会即时预览。"
                      : "Tune the workspace presentation with an instant preview."}
                  </p>
                </div>
              </header>
              <div className="settings-preference-list">
              <div className="setting-group">
                <div className="setting-copy">
                  <label>{t.appearance}</label>
                  <small>
                    {effectiveSettings.language === "zh-CN"
                      ? "跟随系统或固定使用亮色、暗色主题"
                      : "Follow the system or keep a fixed light or dark theme"}
                  </small>
                </div>
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
                <div className="setting-copy">
                  <label>{t.language}</label>
                  <small>
                    {effectiveSettings.language === "zh-CN"
                      ? "切换界面、菜单和提示信息的语言"
                      : "Change the language used by the interface and menus"}
                  </small>
                </div>
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
                <div className="setting-copy">
                  <label>{t.density}</label>
                  <small>
                    {effectiveSettings.language === "zh-CN"
                      ? "控制日志工作区的间距与信息密度"
                      : "Control spacing and information density in the log workspace"}
                  </small>
                </div>
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
              {error && <div className="alert" role="alert">{error}</div>}
            </section>
            <footer className="settings-page-footer">
              <span>
                {effectiveSettings.language === "zh-CN"
                  ? "未保存的更改会在返回时撤销"
                  : "Unsaved changes are discarded when you go back"}
              </span>
              <button
                className="primary save-settings"
                onClick={savePreferences}
                disabled={savingSettings}
              >
                {savingSettings ? t.saving : t.save}
              </button>
            </footer>
          </div>
        </section>
      )}
    </main>
  );
}
export default App;
