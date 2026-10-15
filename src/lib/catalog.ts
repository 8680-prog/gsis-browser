/**
 * Curated links for the Games and Apps pages. These are ordinary public
 * websites; whether each one renders inside Fern is decided live by the
 * embed check, because sites change their framing policy over time.
 */

export interface CatalogItem {
  name: string;
  url: string;
  description: string;
  category: string;
}

export const APPS: CatalogItem[] = [
  { name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Main_Page', description: 'The free encyclopedia.', category: 'Reference' },
  { name: 'Wiktionary', url: 'https://en.wiktionary.org/wiki/Wiktionary:Main_Page', description: 'Free dictionary and thesaurus.', category: 'Reference' },
  { name: 'Project Gutenberg', url: 'https://www.gutenberg.org/', description: '70,000+ free public-domain ebooks.', category: 'Reference' },
  { name: 'Internet Archive', url: 'https://archive.org/', description: 'Books, media and the Wayback Machine.', category: 'Reference' },
  { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/export/embed.html?bbox=-0.25,51.43,0.05,51.57&layer=mapnik', description: 'Open map designed for embedding.', category: 'Tools' },
  { name: 'Desmos Graphing', url: 'https://www.desmos.com/calculator', description: 'Graphing calculator.', category: 'Math' },
  { name: 'GeoGebra', url: 'https://www.geogebra.org/calculator', description: 'Geometry, algebra and graphing.', category: 'Math' },
  { name: 'Excalidraw', url: 'https://excalidraw.com/', description: 'Hand-drawn style whiteboard.', category: 'Create' },
  { name: 'Photopea', url: 'https://www.photopea.com/', description: 'Image editor in the browser.', category: 'Create' },
  { name: 'Scratch', url: 'https://scratch.mit.edu/', description: 'Create stories, games and animations.', category: 'Create' },
  { name: 'MDN Web Docs', url: 'https://developer.mozilla.org/', description: 'Web developer documentation.', category: 'Reference' },
  { name: 'Khan Academy', url: 'https://www.khanacademy.org/', description: 'Free courses and practice.', category: 'Learn' },
];

export const GAMES: CatalogItem[] = [
  { name: 'Lichess Puzzles', url: 'https://lichess.org/training/frame', description: 'Daily chess puzzle (official embed).', category: 'Strategy' },
  { name: 'Lichess TV', url: 'https://lichess.org/tv/frame', description: 'Watch live top games (official embed).', category: 'Strategy' },
  { name: '2048', url: 'https://play2048.co/', description: 'Slide and merge the tiles.', category: 'Puzzle' },
  { name: 'Hextris', url: 'https://hextris.io/', description: 'Open-source hexagonal Tetris-like game.', category: 'Puzzle' },
  { name: 'Little Alchemy 2', url: 'https://littlealchemy2.com/', description: 'Combine elements to discover new ones.', category: 'Puzzle' },
  { name: 'Chrome Dino', url: 'https://chromedino.com/', description: 'The offline dinosaur runner.', category: 'Arcade' },
  { name: 'Slither.io', url: 'https://slither.io/', description: 'Multiplayer snake.', category: 'Arcade' },
  { name: 'Paper.io', url: 'https://paper-io.com/', description: 'Claim territory.', category: 'Arcade' },
  { name: 'Krunker', url: 'https://krunker.io/', description: 'Browser first-person arena.', category: 'Action' },
  { name: 'TypeRacer', url: 'https://play.typeracer.com/', description: 'Typing races.', category: 'Skill' },
  { name: 'Scratch Games', url: 'https://scratch.mit.edu/explore/projects/games/', description: 'Community-made games.', category: 'Community' },
];

export const DEFAULT_SHORTCUTS = [
  { title: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Main_Page' },
  { title: 'OpenStreetMap', url: 'https://www.openstreetmap.org/export/embed.html?bbox=-0.25,51.43,0.05,51.57&layer=mapnik' },
  { title: 'Desmos', url: 'https://www.desmos.com/calculator' },
  { title: 'Lichess', url: 'https://lichess.org/training/frame' },
  { title: 'Gutenberg', url: 'https://www.gutenberg.org/' },
  { title: 'Excalidraw', url: 'https://excalidraw.com/' },
];
