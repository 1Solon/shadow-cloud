import { Popover, Select } from "radix-ui";
import { useState } from "react";
import type { Campaign, Command, Snapshot, SyncStatus } from "../engine/port";

const statuses: { value: SyncStatus; label: string }[] = [
  { value: "conflict", label: "Conflict" },
  { value: "receiving", label: "Receiving" },
  { value: "needs-attention", label: "Needs attention" },
  { value: "sending", label: "Sending" },
  { value: "synchronized", label: "Synchronized" },
  { value: "archived", label: "Archived" },
];
const sorts = [
  { value: "name", label: "Name" },
  { value: "turn-oldest", label: "Turn (Oldest)" },
  { value: "turn-newest", label: "Turn (Newest)" },
] as const;
type Sort = (typeof sorts)[number]["value"];
const names = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const compareNames = (left: Campaign, right: Campaign) =>
  names.compare(left.name, right.name) || left.number - right.number;

function compare(left: Campaign, right: Campaign, sort: Sort) {
  if (sort === "name") return compareNames(left, right);
  const a = Date.parse(left.turnStartedAt ?? "");
  const b = Date.parse(right.turnStartedAt ?? "");
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return Number.isNaN(a) === Number.isNaN(b)
      ? compareNames(left, right)
      : Number.isNaN(a)
        ? 1
        : -1;
  }
  return (sort === "turn-oldest" ? a - b : b - a) || compareNames(left, right);
}

const actionLabels = {
  "resolve-conflict": "> RESOLVE CONFLICT",
  "cancel-automatic-send": "> CANCEL SEND",
  "open-folder": "OPEN FOLDER",
  "redownload-current": "REDOWNLOAD CURRENT SAVE",
};

export function Campaigns({
  snapshot,
  send,
  pending,
}: {
  snapshot: Snapshot;
  send: (command: Command) => Promise<void>;
  pending: boolean;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("turn-newest");
  const [visibleStatuses, setVisibleStatuses] = useState<Set<SyncStatus>>(
    () => new Set(statuses.map((status) => status.value)),
  );
  const query = search.trim().toLowerCase();
  const visible = snapshot.campaigns
    .filter(
      (campaign) =>
        visibleStatuses.has(campaign.syncStatus) &&
        (!query ||
          String(campaign.number).includes(query) ||
          campaign.name.toLowerCase().includes(query)),
    )
    .sort((left, right) => compare(left, right, sort));
  const filtered = query !== "" || visibleStatuses.size !== statuses.length;
  const count = filtered
    ? `${visible.length} / ${snapshot.campaigns.length}`
    : String(visible.length);
  // Overall actionable state must survive a visibility-only filter.
  const attention = snapshot.campaigns.filter(
    (campaign) =>
      campaign.syncStatus === "conflict" ||
      campaign.syncStatus === "sending" ||
      campaign.syncStatus === "needs-attention",
  ).length;
  const statusSummary =
    visibleStatuses.size === statuses.length
      ? "All statuses"
      : visibleStatuses.size === 0
        ? "No statuses"
        : visibleStatuses.size === 1
          ? statuses.find((status) => visibleStatuses.has(status.value))!.label
          : `${visibleStatuses.size} of ${statuses.length} shown`;
  const reset = () => {
    setSearch("");
    setVisibleStatuses(new Set(statuses.map((status) => status.value)));
  };

  return (
    <section className="campaigns-page" aria-label="Your campaigns">
      <div className="campaign-list-header">
        <div className="campaign-list-heading">
          <div className="section-heading">
            <h1>{`> YOUR CAMPAIGNS (${count})`}</h1>
            {attention > 0 && (
              <span>{`${attention} NEED${attention === 1 ? "S" : ""} YOUR ATTENTION`}</span>
            )}
          </div>
          <p className="section-intro">
            Shadow Cloud receives campaign saves into these folders. Sending
            turns is coming in a later update.
          </p>
        </div>
        <div className="campaign-list-controls">
          <label className="campaign-control">
            SEARCH
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Number or name"
              aria-label="Search your campaigns by campaign number or name"
            />
          </label>
          <div className="campaign-control">
            <span>SORT BY</span>
            <Select.Root
              value={sort}
              onValueChange={(value) => {
                if (sorts.some((item) => item.value === value))
                  setSort(value as Sort);
              }}
            >
              <Select.Trigger
                className="select-trigger"
                aria-label="Sort your campaigns"
              >
                <Select.Value />
                <Select.Icon aria-hidden="true">⌄</Select.Icon>
              </Select.Trigger>
              <Select.Portal>
                <Select.Content
                  className="select-menu"
                  position="popper"
                  sideOffset={4}
                >
                  <Select.Viewport>
                    {sorts.map((item) => (
                      <Select.Item
                        className="select-option"
                        key={item.value}
                        value={item.value}
                      >
                        <Select.ItemText>{item.label}</Select.ItemText>
                        <Select.ItemIndicator>✓</Select.ItemIndicator>
                      </Select.Item>
                    ))}
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
          </div>
          <div className="campaign-control">
            <span>SYNC STATUS</span>
            <Popover.Root>
              <Popover.Trigger
                className="select-trigger"
                aria-label={`Filter your campaigns by sync status: ${statusSummary}`}
              >
                {statusSummary}
                <span aria-hidden="true">⌄</span>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  className="status-menu"
                  align="end"
                  sideOffset={4}
                  aria-label="Campaign visibility"
                >
                  <fieldset>
                    <legend className="sr-only">
                      Show campaigns with sync status
                    </legend>
                    {statuses.map(({ value, label }) => (
                      <label key={value}>
                        <input
                          type="checkbox"
                          aria-label={`Show ${label} campaigns`}
                          checked={visibleStatuses.has(value)}
                          onChange={() =>
                            setVisibleStatuses((current) => {
                              const next = new Set(current);
                              if (next.has(value)) next.delete(value);
                              else next.add(value);
                              return next;
                            })
                          }
                        />
                        <span>{label}</span>
                        <small>
                          {
                            snapshot.campaigns.filter(
                              (campaign) => campaign.syncStatus === value,
                            ).length
                          }
                        </small>
                      </label>
                    ))}
                  </fieldset>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </div>
        </div>
      </div>
      <p className="sr-only" role="status">
        {visible.length} of {snapshot.campaigns.length} campaigns shown
      </p>
      <div className="campaign-list">
        {visible.map((campaign) => (
          <article
            className={`campaign-card campaign-card--${campaign.syncStatus}`}
            key={campaign.id}
            aria-labelledby={`campaign-${campaign.id}`}
          >
            <div className="campaign-summary">
              <div className="campaign-identity">
                <h2
                  id={`campaign-${campaign.id}`}
                  title={`${campaign.number} : ${campaign.name}`}
                >
                  {campaign.number} : {campaign.name}
                </h2>
                <small>
                  Turn {campaign.round} · Updated {campaign.lastTransfer}
                  {campaign.archiveBytes !== undefined &&
                    ` · Archive: ${(campaign.archiveBytes / (1024 * 1024)).toFixed(1)} MiB received`}
                </small>
              </div>
              <dl className="campaign-facts">
                <div>
                  <dt>SYNC STATUS</dt>
                  <dd className="status-value" title={campaign.detail}>
                    {campaign.statusLabel}
                  </dd>
                </div>
                <div>
                  <dt>ACTIVE LORD</dt>
                  <dd title={campaign.activeLord}>{campaign.activeLord}</dd>
                </div>
                <div>
                  <dt>TRANSFER</dt>
                  <dd>{campaign.automaticUploads ? "Automatic" : "Manual"}</dd>
                </div>
              </dl>
            </div>
            {(campaign.syncStatus === "needs-attention" ||
              campaign.syncStatus === "receiving") && (
              <p className="campaign-receive-detail">{campaign.detail}</p>
            )}
            {campaign.actions.length > 0 && (
              <div className="campaign-actions">
                {campaign.actions.map((action) => (
                  <button
                    key={action}
                    className={
                      action === "resolve-conflict"
                        ? "danger-button"
                        : action === "open-folder"
                          ? "outline-button"
                          : "primary-button"
                    }
                    type="button"
                    disabled={pending || snapshot.readOnly}
                    onClick={() =>
                      void send({
                        type: "campaign-action",
                        campaignId: campaign.id,
                        action,
                      })
                    }
                  >
                    {actionLabels[action]}
                  </button>
                ))}
              </div>
            )}
          </article>
        ))}
        {visible.length === 0 && (
          <div className="empty-state">
            <div>
              <strong>
                {snapshot.campaigns.length
                  ? "NO CAMPAIGNS MATCH THESE FILTERS"
                  : "NO CAMPAIGNS CONNECTED"}
              </strong>
              <p>
                {snapshot.campaigns.length
                  ? "Change your search or show another sync status."
                  : "Campaigns will appear after connecting to Shadow Cloud. Their saves are received once setup is complete."}
              </p>
            </div>
            {snapshot.campaigns.length > 0 && (
              <button className="outline-button" type="button" onClick={reset}>
                SHOW ALL CAMPAIGNS
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
