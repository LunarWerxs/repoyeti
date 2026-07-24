import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createI18n } from "vue-i18n";
import HistoryActivityView from "@/components/HistoryActivity.vue";
import type { HistoryActivity } from "@/types";

const messages = {
  en: {
    repo: {
      history: {
        activityOneHour: "1h commits",
        activityTwentyFourHours: "24h commits",
        activityContributors: "People",
        activityLinesChanged: "Lines changed",
        activityAveragePerHour: "Avg lines/hour",
        activityTopAuthors: "By person",
        activityLoading: "Loading activity",
        activityEmpty: "No commits in the last 24 hours",
        activityError: "Activity is unavailable",
        activityTruncated: "Partial",
        activityChartTitle: "Hourly activity",
        activityAdded: "Added",
        activityRemoved: "Removed",
        activityCommitsLegend: "Commits",
        activityChartLabel: "Repository activity over {hours} hours",
        activityCommitCount: "{count} commit | {count} commits",
        activityFileCount: "{count} file | {count} files",
        activityAuthorSummary:
          "{name} ({email}) · {commits} · +{added} −{removed}",
        activityBucketSummary:
          "{time} · {commits} · {files} · +{added} −{removed}",
      },
    },
  },
};

const start = Date.UTC(2026, 6, 23, 18);

function makeActivity(overrides: Partial<HistoryActivity> = {}): HistoryActivity {
  return {
    ok: true,
    code: "OK",
    windowHours: 24,
    since: start,
    until: start + 24 * 60 * 60 * 1000,
    commits: 8,
    commitsLastHour: 2,
    contributors: 3,
    filesChanged: 17,
    addedLines: 120,
    removedLines: 48,
    authors: [
      { name: "Ada Lovelace", email: "ada@example.test", commits: 3, addedLines: 30, removedLines: 8 },
      { name: "Grace Hopper", email: "grace@example.test", commits: 5, addedLines: 90, removedLines: 40 },
    ],
    buckets: Array.from({ length: 24 }, (_, index) => ({
      start: start + index * 60 * 60 * 1000,
      commits: index === 10 ? 3 : index === 23 ? 2 : 0,
      filesChanged: index === 10 ? 5 : index === 23 ? 4 : 0,
      addedLines: index === 10 ? 120 : 0,
      removedLines: index === 10 ? 30 : index === 23 ? 18 : 0,
    })),
    truncated: false,
    ...overrides,
  };
}

function render(props: { activity: HistoryActivity | null; loading?: boolean }) {
  const i18n = createI18n({
    legacy: false,
    locale: "en",
    messages,
  });
  return mount(HistoryActivityView, {
    props: { loading: false, ...props },
    global: { plugins: [i18n] },
  });
}

describe("HistoryActivity.vue", () => {
  it("renders all five KPIs and orders author chips by commit count", () => {
    const wrapper = render({ activity: makeActivity() });

    expect(wrapper.get('[data-activity-kpi="last-hour"] .activity-kpi-value').text()).toBe("2");
    expect(wrapper.get('[data-activity-kpi="window"] .activity-kpi-value').text()).toBe("8");
    expect(wrapper.get('[data-activity-kpi="contributors"] .activity-kpi-value').text()).toBe("3");
    expect(wrapper.get('[data-activity-kpi="lines"] .activity-kpi-value').text()).toBe("168");
    // (120 additions + 48 removals) / 24 hours.
    expect(wrapper.get('[data-activity-kpi="average"] .activity-kpi-value').text()).toBe("7.0");

    const authors = wrapper.findAll("[data-activity-author]");
    expect(authors).toHaveLength(2);
    expect(authors[0]!.text()).toContain("Grace Hopper");
    expect(authors[0]!.text()).toContain("5");
    expect(authors[1]!.text()).toContain("Ada Lovelace");
  });

  it("draws stacked line-change bars and a commit line, with exact focus details", async () => {
    const wrapper = render({ activity: makeActivity() });

    expect(wrapper.findAll('[data-series="added"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-series="removed"]')).toHaveLength(2);
    expect(wrapper.get('[data-series="commits"]').attributes("points")).not.toBe("");

    await wrapper.get('[data-activity-bucket="10"]').trigger("focus");
    const tooltip = wrapper.get('[data-testid="history-activity-tooltip"]');
    expect(tooltip.text()).toContain("3 commits");
    expect(tooltip.text()).toContain("5 files");
    expect(tooltip.text()).toContain("+120");
    expect(tooltip.text()).toContain("−30");

    await wrapper.get('[data-activity-bucket="10"]').trigger("blur");
    expect(wrapper.find('[data-testid="history-activity-tooltip"]').exists()).toBe(false);
  });

  it("uses singular commit and file labels when a bucket contains one of each", async () => {
    const wrapper = render({
      activity: makeActivity({
        authors: [
          {
            name: "Solo Coder",
            email: "solo@example.test",
            commits: 1,
            addedLines: 4,
            removedLines: 2,
          },
        ],
        buckets: [
          {
            start,
            commits: 1,
            filesChanged: 1,
            addedLines: 4,
            removedLines: 2,
          },
        ],
      }),
    });

    await wrapper.get('[data-activity-bucket="0"]').trigger("focus");
    const tooltip = wrapper.get('[data-testid="history-activity-tooltip"]').text();
    expect(tooltip).toContain("1 commit");
    expect(tooltip).toContain("1 file");
    expect(tooltip).not.toContain("1 commits");
    expect(tooltip).not.toContain("1 files");
    const authorTitle = wrapper.get("[data-activity-author]").attributes("title");
    expect(authorTitle).toContain("1 commit");
    expect(authorTitle).not.toContain("1 commits");
  });

  it("keeps loading, empty, and error states compact and explicit", () => {
    const loading = render({ activity: null, loading: true });
    expect(loading.get('[data-testid="history-activity"]').attributes("data-state")).toBe("loading");
    expect(loading.text()).toContain("Loading activity");

    const empty = render({
      activity: makeActivity({
        commits: 0,
        commitsLastHour: 0,
        contributors: 0,
        filesChanged: 0,
        addedLines: 0,
        removedLines: 0,
        authors: [],
        buckets: [],
      }),
    });
    expect(empty.get('[data-testid="history-activity"]').attributes("data-state")).toBe("empty");
    expect(empty.text()).toContain("No commits in the last 24 hours");

    const error = render({
      activity: makeActivity({ ok: false, code: "GIT_FAILED", message: "History unavailable" }),
    });
    expect(error.get('[data-testid="history-activity"]').attributes("data-state")).toBe("error");
    expect(error.text()).toContain("History unavailable");
  });

  it("marks capped results without replacing still-useful activity", () => {
    const wrapper = render({ activity: makeActivity({ truncated: true }) });
    expect(wrapper.get('[data-testid="history-activity"]').attributes("data-state")).toBe("ready");
    expect(wrapper.text()).toContain("Partial");
    expect(wrapper.find('[data-testid="history-activity-chart"]').exists()).toBe(true);
  });
});
