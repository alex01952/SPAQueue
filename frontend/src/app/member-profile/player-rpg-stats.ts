export interface PlayerRpgStat {
  key: string;
  label: string;
  score: number;
  maximum: number;
  percentage: number;
  jobTitle: string;
}

interface StatDefinition {
  key: string;
  label: string;
  skills: string[];
  maximum: number;
  jobs: Array<{ maximumScore: number; title: string }>;
}

const statDefinitions: StatDefinition[] = [
  {
    key: 'intelligence',
    label: 'Intelligence',
    skills: ['shotSelection', 'courtAwareness', 'communication', 'consistency', 'accuracy', 'shotPlacement'],
    maximum: 60,
    jobs: [
      { maximumScore: 10, title: 'Button Masher' },
      { maximumScore: 20, title: 'Mage Apprentice' },
      { maximumScore: 30, title: 'Novice Mage' },
      { maximumScore: 40, title: 'Elemental Mage' },
      { maximumScore: 45, title: 'Battle Mage' },
      { maximumScore: 50, title: 'High Mage' },
      { maximumScore: 55, title: 'Archmage' },
      { maximumScore: 59, title: 'Grand Strategist' },
      { maximumScore: 60, title: 'Supreme Court Wizard' },
    ],
  },
  {
    key: 'attack',
    label: 'Attack',
    skills: ['drive', 'speedUp', 'counter', 'flick', 'roll', 'attack'],
    maximum: 60,
    jobs: [
      { maximumScore: 10, title: 'Pacifist' },
      { maximumScore: 20, title: 'Swordsman Apprentice' },
      { maximumScore: 30, title: 'Swordsman' },
      { maximumScore: 40, title: 'Fighter' },
      { maximumScore: 45, title: 'Warrior' },
      { maximumScore: 50, title: 'Berserker' },
      { maximumScore: 55, title: 'Warlord' },
      { maximumScore: 59, title: 'Destroyer' },
      { maximumScore: 60, title: 'Demon Lord' },
    ],
  },
  {
    key: 'defense',
    label: 'Defense',
    skills: ['reset', 'block', 'defense', 'courtCoverage'],
    maximum: 40,
    jobs: [
      { maximumScore: 6, title: 'Paper Armor' },
      { maximumScore: 11, title: 'Shield Bearer' },
      { maximumScore: 16, title: 'Guard' },
      { maximumScore: 21, title: 'Defender' },
      { maximumScore: 26, title: 'Guardian' },
      { maximumScore: 31, title: 'Knight' },
      { maximumScore: 35, title: 'Paladin' },
      { maximumScore: 39, title: 'Fortress' },
      { maximumScore: 40, title: 'Immortal Wall' },
    ],
  },
  {
    key: 'technique',
    label: 'Technique',
    skills: ['serve', 'return', 'drop', 'dink', 'volley', 'lob', 'overhead'],
    maximum: 70,
    jobs: [
      { maximumScore: 10, title: 'Ball Smacker' },
      { maximumScore: 20, title: 'Apprentice' },
      { maximumScore: 30, title: 'Rookie Rogue' },
      { maximumScore: 40, title: 'Martial Artist' },
      { maximumScore: 50, title: 'Rogue' },
      { maximumScore: 58, title: 'Sword Saint' },
      { maximumScore: 64, title: 'Master' },
      { maximumScore: 69, title: 'Grandmaster' },
      { maximumScore: 70, title: 'Pickleball Sensei' },
    ],
  },
  {
    key: 'agility',
    label: 'Agility',
    skills: ['footwork', 'positioning', 'courtCoverage', 'speed'],
    maximum: 40,
    jobs: [
      { maximumScore: 6, title: 'Statue' },
      { maximumScore: 11, title: 'Turtle' },
      { maximumScore: 16, title: 'Runner' },
      { maximumScore: 21, title: 'Rogue' },
      { maximumScore: 26, title: 'Scout' },
      { maximumScore: 31, title: 'Ninja' },
      { maximumScore: 35, title: 'Speedster' },
      { maximumScore: 39, title: 'Lightning Ninja' },
      { maximumScore: 40, title: 'Teleporting Menace' },
    ],
  },
  {
    key: 'teamMental',
    label: 'Team / Mental',
    skills: ['communication', 'consistency', 'courtAwareness', 'shotSelection'],
    maximum: 40,
    jobs: [
      { maximumScore: 6, title: 'Silent NPC' },
      { maximumScore: 11, title: 'Villager' },
      { maximumScore: 16, title: 'Cheerleader' },
      { maximumScore: 21, title: 'Shot Caller' },
      { maximumScore: 26, title: 'Lieutenant' },
      { maximumScore: 31, title: 'Captain' },
      { maximumScore: 35, title: 'Commander' },
      { maximumScore: 39, title: 'Field Marshal' },
      { maximumScore: 40, title: 'Hive Mind' },
    ],
  },
];

export function calculatePlayerRpgStats(
  skills: Record<string, number | null> | undefined,
): { stats: PlayerRpgStat[]; highestStats: PlayerRpgStat[]; jobTitles: string[] } {
  const stats = statDefinitions.map((definition) => {
    const score = definition.skills.reduce(
      (total, skill) => total + Math.min(Math.max(Number(skills?.[skill] ?? 0), 0), 10),
      0,
    );
    const jobTitle = definition.jobs.find((job) => score <= job.maximumScore)?.title ?? definition.jobs.at(-1)?.title ?? 'Unranked';

    return {
      key: definition.key,
      label: definition.label,
      score,
      maximum: definition.maximum,
      percentage: Math.round((score / definition.maximum) * 100),
      jobTitle,
    };
  });
  const highestPercentage = Math.max(...stats.map((stat) => stat.percentage));
  const highestStats = stats.filter((stat) => stat.percentage === highestPercentage);

  return {
    stats,
    highestStats,
    jobTitles: highestStats.map((stat) => stat.jobTitle),
  };
}
