export interface Env {
  USER_NOTIFICATION: KVNamespace;
}

type Merchant = "Skier" | "Therapist" | "Prapor";
type QuestStatus = "locked" | "available" | "completed" | "failed";

interface Quest {
  id: string;
  name: string;
  merchant: Merchant;
  previousQuestIds: string[];
  leadsToQuestIds: string[];
  choiceGroupId?: string;
  initiallyAvailable?: boolean;
}

interface ChoiceGroup {
  id: string;
  label: string;
  choiceQuestIds: string[];
  outcomes: Record<string, ChoiceOutcome>;
}

interface ChoiceOutcome {
  unlockedQuestIds: string[];
  failedQuestIds: string[];
  recoveryQuestIds: string[];
  reputationDeltas: Partial<Record<Merchant, number>>;
}

interface QuestProgress {
  status: QuestStatus;
  completedAt?: string;
  failedAt?: string;
}

interface UserProgress {
  quests: Record<string, QuestProgress>;
  choices: Record<
    string,
    {
      selectedQuestId: string;
      selectedMerchant: Merchant;
      selectedAt: string;
      outcome?: ChoiceOutcome;
    }
  >;
}

const quests: Quest[] = [
  {
    id: "chemical-part-3",
    name: "Chemical - Part 3",
    merchant: "Skier",
    previousQuestIds: [],
    leadsToQuestIds: [
      "chemical-part-4",
      "out-of-curiosity",
      "big-customer",
    ],
    initiallyAvailable: true,
  },
  {
    id: "chemical-part-4",
    name: "Chemical - Part 4",
    merchant: "Skier",
    previousQuestIds: ["chemical-part-3"],
    leadsToQuestIds: [],
    choiceGroupId: "chemical-part-4-resolution",
  },
  {
    id: "out-of-curiosity",
    name: "Out of Curiosity",
    merchant: "Therapist",
    previousQuestIds: ["chemical-part-3"],
    leadsToQuestIds: [],
    choiceGroupId: "chemical-part-4-resolution",
  },
  {
    id: "big-customer",
    name: "Big Customer",
    merchant: "Prapor",
    previousQuestIds: ["chemical-part-3"],
    leadsToQuestIds: [],
    choiceGroupId: "chemical-part-4-resolution",
  },
  {
    id: "loyalty-buyout",
    name: "Loyalty Buyout",
    merchant: "Skier",
    previousQuestIds: [],
    leadsToQuestIds: [],
  },
  {
    id: "trust-regain",
    name: "Trust Regain",
    merchant: "Therapist",
    previousQuestIds: [],
    leadsToQuestIds: [],
  },
  {
    id: "no-offence",
    name: "No Offence",
    merchant: "Prapor",
    previousQuestIds: [],
    leadsToQuestIds: [],
  },
  {
    id: "safe-corridor",
    name: "Safe Corridor",
    merchant: "Skier",
    previousQuestIds: [],
    leadsToQuestIds: [],
  },
];

const choiceGroups: ChoiceGroup[] = [
  {
    id: "chemical-part-4-resolution",
    label: "Choix de rendu Chemical - Part 4",
    choiceQuestIds: ["chemical-part-4", "out-of-curiosity", "big-customer"],
    outcomes: {
      "chemical-part-4": {
        unlockedQuestIds: ["no-offence", "trust-regain", "loyalty-buyout"],
        failedQuestIds: ["big-customer", "out-of-curiosity"],
        recoveryQuestIds: ["trust-regain", "loyalty-buyout", "no-offence"],
        reputationDeltas: {
          Prapor: -0.25,
          Therapist: -0.25,
        },
      },
    },
  },
];

const questById = new Map(quests.map((quest) => [quest.id, quest]));
const choiceGroupById = new Map(choiceGroups.map((group) => [group.id, group]));

class ClientError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...init?.headers,
    },
  });
}

function getProgressKey(userId: string): string {
  return `quest-progress:${userId}`;
}

function createDefaultProgress(): UserProgress {
  const progress: UserProgress = {
    quests: {},
    choices: {},
  };

  for (const quest of quests) {
    progress.quests[quest.id] = {
      status: quest.initiallyAvailable ? "available" : "locked",
    };
  }

  return progress;
}

async function loadProgress(env: Env, userId: string): Promise<UserProgress> {
  const storedProgress = await env.USER_NOTIFICATION.get(getProgressKey(userId));
  const defaultProgress = createDefaultProgress();

  if (!storedProgress) {
    return defaultProgress;
  }

  const parsedProgress = JSON.parse(storedProgress) as Partial<UserProgress>;

  return {
    quests: {
      ...defaultProgress.quests,
      ...parsedProgress.quests,
    },
    choices: {
      ...defaultProgress.choices,
      ...parsedProgress.choices,
    },
  };
}

async function saveProgress(
  env: Env,
  userId: string,
  progress: UserProgress,
): Promise<void> {
  await env.USER_NOTIFICATION.put(getProgressKey(userId), JSON.stringify(progress));
}

function unlockQuest(progress: UserProgress, questId: string): void {
  const questProgress = progress.quests[questId];

  if (!questProgress || questProgress.status !== "locked") {
    return;
  }

  questProgress.status = "available";
}

function completeQuest(progress: UserProgress, questId: string, completedAt: string): void {
  const quest = questById.get(questId);

  if (!quest) {
    throw new ClientError(`Unknown quest: ${questId}`, 404);
  }

  const questProgress = progress.quests[questId];

  if (!questProgress || questProgress.status === "locked") {
    throw new ClientError(`Quest is locked: ${questId}`);
  }

  if (questProgress.status === "failed") {
    throw new ClientError(`Quest has failed and cannot be completed: ${questId}`);
  }

  if (questProgress.status === "completed") {
    return;
  }

  questProgress.status = "completed";
  questProgress.completedAt = completedAt;

  for (const nextQuestId of quest.leadsToQuestIds) {
    unlockQuest(progress, nextQuestId);
  }
}

function completeChoice(
  progress: UserProgress,
  choiceGroupId: string,
  selectedQuestId: string,
): void {
  const choiceGroup = choiceGroupById.get(choiceGroupId);
  const selectedQuest = questById.get(selectedQuestId);

  if (!choiceGroup || !selectedQuest) {
    throw new ClientError("Unknown choice");
  }

  if (!choiceGroup.choiceQuestIds.includes(selectedQuestId)) {
    throw new ClientError("Quest is not part of this choice group");
  }

  const existingChoice = progress.choices[choiceGroupId];

  if (existingChoice && existingChoice.selectedQuestId !== selectedQuestId) {
    throw new ClientError("Choice group has already been resolved");
  }

  const resolvedAt = new Date().toISOString();
  const outcome = choiceGroup.outcomes[selectedQuestId];
  completeQuest(progress, selectedQuestId, resolvedAt);

  for (const questId of outcome?.unlockedQuestIds ?? []) {
    unlockQuest(progress, questId);
  }

  const failedQuestIds =
    outcome?.failedQuestIds ??
    choiceGroup.choiceQuestIds.filter((questId) => questId !== selectedQuestId);

  for (const questId of failedQuestIds) {
    progress.quests[questId] = {
      status: "failed",
      failedAt: resolvedAt,
    };
  }

  progress.choices[choiceGroupId] = {
    selectedQuestId,
    selectedMerchant: selectedQuest.merchant,
    selectedAt: resolvedAt,
    outcome,
  };
}

function getQuestIdForChemicalMerchant(merchant: string | null): string | null {
  switch (merchant?.toLowerCase()) {
    case "skier":
      return "chemical-part-4";
    case "therapist":
      return "out-of-curiosity";
    case "prapor":
      return "big-customer";
    default:
      return null;
  }
}

async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ClientError("Invalid JSON body");
  }
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathParts = url.pathname.split("/").filter(Boolean);

  if (request.method === "GET" && url.pathname === "/quests") {
    return json({ quests, choiceGroups });
  }

  if (
    request.method === "GET" &&
    pathParts.length === 2 &&
    pathParts[0] === "progress"
  ) {
    const userId = pathParts[1];
    return json(await loadProgress(env, userId));
  }

  if (
    request.method === "POST" &&
    pathParts.length === 4 &&
    pathParts[0] === "progress" &&
    pathParts[2] === "quests" &&
    pathParts[3] !== ""
  ) {
    return json({ error: "Missing action" }, { status: 404 });
  }

  if (
    request.method === "POST" &&
    pathParts.length === 5 &&
    pathParts[0] === "progress" &&
    pathParts[2] === "quests" &&
    pathParts[4] === "complete"
  ) {
    const userId = pathParts[1];
    const questId = pathParts[3];
    const quest = questById.get(questId);

    if (!quest) {
      return json({ error: `Unknown quest: ${questId}` }, { status: 404 });
    }

    const progress = await loadProgress(env, userId);

    if (quest.choiceGroupId) {
      completeChoice(progress, quest.choiceGroupId, questId);
    } else {
      completeQuest(progress, questId, new Date().toISOString());
    }

    await saveProgress(env, userId, progress);

    return json(progress);
  }

  if (
    request.method === "POST" &&
    pathParts.length === 3 &&
    pathParts[0] === "progress" &&
    pathParts[2] === "chemical-choice"
  ) {
    const userId = pathParts[1];
    const body = await readJsonBody<{ merchant?: string; questId?: string }>(request);
    const selectedQuestId =
      body.questId ?? getQuestIdForChemicalMerchant(body.merchant ?? null);

    if (!selectedQuestId) {
      return json(
        {
          error:
            "Choose one of: merchant=Skier, merchant=Therapist, merchant=Prapor",
        },
        { status: 400 },
      );
    }

    const progress = await loadProgress(env, userId);
    completeChoice(progress, "chemical-part-4-resolution", selectedQuestId);
    await saveProgress(env, userId, progress);

    return json(progress);
  }

  return json(
    {
      endpoints: [
        "GET /quests",
        "GET /progress/:userId",
        "POST /progress/:userId/quests/:questId/complete",
        "POST /progress/:userId/chemical-choice { merchant: 'Skier' | 'Therapist' | 'Prapor' }",
      ],
    },
    { status: 404 },
  );
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "An unknown error occurred";
      const status = err instanceof ClientError ? err.status : 500;

      return json({ error: errorMessage }, { status });
    }
  },
} satisfies ExportedHandler<Env>;
