import { folders, linkedin, links, profile, school } from './data.ts';

const entries = (id: string) => folders.find((f) => f.id === id)?.entries ?? [];

/** What the auto-reply may say about Josh: only what the site already shows. */
export function personaFacts(): string {
  const work = entries('work').map((e) => `${e.name} (${e.role}${e.meta && e.meta !== 'now' ? `, ${e.meta}` : ', current'})`);
  const projects = entries('projects').map((e) => `${e.name}: ${e.meta}`);
  return [
    `- ${profile.name}, goes by josh. ${profile.tagline} Based in ${profile.location}.`,
    '- Studies CS + math at Stanford. Coxswain on the Stanford varsity rowing team. Plays badminton when he can.',
    `- ${linkedin.about}. Cognition makes Devin, the AI software engineer.`,
    `- Work: ${work.join('; ')}.`,
    `- At Stanford: Currently: ${school.current.join('; ')}. Past: ${school.past.join('; ')}.`,
    `- Side projects he built and uses: ${projects.join('; ')}.`,
    `- Music: ${linkedin.projects[0].blurb} His single "all i need" is on Spotify, and he posts as kelix on SoundCloud.`,
    `- Speaks ${linkedin.languages.map((l) => l.name).join(', ')}. ${linkedin.awards.map((a) => a.title).join('; ')}. Working paper: "${linkedin.publications[0].title}".`,
    `- Contact: email ${profile.email} is best. @joshuaykoo on X (${links.x}) and Instagram.`,
    '- The site itself is a fake computer you can click around: games in the Arcade, Cox Box (a typing rowing race), Baduk, Badminton, Beat Pad and more.',
  ].join('\n');
}
