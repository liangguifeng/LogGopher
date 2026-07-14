/** Renders provider groups and logstores without rerendering the parent workspace. */
import { memo, useState } from "react";

/** Provider-level parent and its available logstores. */
export type LogGroup = { name: string; logstores: string[] };

type Props = {
  groups: LogGroup[];
  activeGroup: string;
  activeLogstore: string;
  label: string;
  onSelect: (group: string, logstore: string) => void;
};

/** Renders the log resource tree while keeping expansion updates local to the sidebar. */
function LogstoreTree({
  groups,
  activeGroup,
  activeLogstore,
  label,
  onSelect,
}: Props) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(activeGroup ? [activeGroup] : []),
  );

  /** Updates an immutable expansion set so React can detect the local state change. */
  const toggleGroup = (group: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  return (
    <nav className="logstore-tree" aria-label={label}>
      {groups.map((group) => {
        const expanded = expandedGroups.has(group.name);
        const active = group.name === activeGroup;
        return (
          <div
            className={active ? "log-group active" : "log-group"}
            key={group.name}
          >
            <button
              type="button"
              className="project-node"
              aria-expanded={expanded}
              onClick={() => toggleGroup(group.name)}
            >
              <svg
                className={
                  expanded
                    ? "project-chevron expanded"
                    : "project-chevron"
                }
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path d="m6 3.5 4.5 4.5L6 12.5" />
              </svg>
              <svg
                className="project-icon"
                viewBox="0 0 18 18"
                aria-hidden="true"
              >
                <path d="M2.5 4.5h5l1.5 2h6.5v7H2.5z" />
              </svg>
              <span title={group.name}>{group.name}</span>
              <small>{group.logstores.length}</small>
            </button>
            {expanded && (
              <div className="log-group-children" role="group">
                {group.logstores.map((item) => (
                  <button
                    type="button"
                    key={`${group.name}\u0000${item}`}
                    className={
                      active && item === activeLogstore
                        ? "store tree-store active"
                        : "store tree-store"
                    }
                    onClick={() => onSelect(group.name, item)}
                  >
                    <span className="store-icon" aria-hidden="true">
                      <svg viewBox="0 0 18 18">
                        <path d="M4 3.5h10v11H4zM6.5 6.5h5M6.5 9h5M6.5 11.5h3.5" />
                      </svg>
                    </span>
                    <span title={item}>{item}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export default memo(LogstoreTree);
