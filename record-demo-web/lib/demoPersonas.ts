/**
 * Parody “patient” display names and demo addresses.
 * The first 15 entries match `company-demo-billing-automation/src/demoPersonas.js` (keep in sync).
 * Phones use (555) 010-2### — obviously non-assignable; streets are marked Demo.
 */

export type DemoPersonaRow = {
  fullName: string;
  /** (555) 010-2xxx per billing demo */
  phoneDisplay: string;
  /** Street line (number may be replaced in seed) */
  street: string;
};

export function primaryNameForProfile(fullName: string): { firstName: string; lastName: string } {
  const t = fullName.trim();
  const sp = t.split(/\s+/);
  if (sp.length <= 1) return { firstName: t || 'Demo', lastName: 'Patient' };
  return { firstName: sp[0]!, lastName: sp.slice(1).join(' ') };
}

/** One row per seeded client (50); names are unique and clearly not real patients */
export const DEMO_PERSONA_ROWS: DemoPersonaRow[] = [
  { fullName: 'Winston Churchill', phoneDisplay: '(555) 010-2001', street: '10 Downing Demo Rd' },
  { fullName: 'Abraham Lincoln', phoneDisplay: '(555) 010-2002', street: '1600 Log Cabin Demo Ave' },
  { fullName: 'George Washington', phoneDisplay: '(555) 010-2003', street: '1 Cherry Tree Demo Ln' },
  { fullName: 'Eleanor Roosevelt', phoneDisplay: '(555) 010-2004', street: 'Hyde Park Demo Cottage' },
  { fullName: 'Frida Kahlo', phoneDisplay: '(555) 010-2005', street: 'La Casa Azul Demo' },
  { fullName: 'Albert Einstein', phoneDisplay: '(555) 010-2006', street: '76 Princeton Demo Hall' },
  { fullName: 'Cleopatra VII', phoneDisplay: '(555) 010-2007', street: '1 Nile Barge Demo Dock' },
  { fullName: 'Leonardo da Vinci', phoneDisplay: '(555) 010-2008', street: 'Via Vinci Demo Studio' },
  { fullName: 'Franklin D. Roosevelt', phoneDisplay: '(555) 010-2009', street: 'Hyde Park Demo Wheelchair Ramp' },
  { fullName: 'Nelson Mandela', phoneDisplay: '(555) 010-2010', street: 'Vilakazi St Demo House' },
  { fullName: 'Marie Curie', phoneDisplay: '(555) 010-2011', street: 'Radium Alley Demo Lab' },
  { fullName: 'Ada Lovelace', phoneDisplay: '(555) 010-2012', street: 'Analytical Engine Demo Loft' },
  { fullName: 'Charles Darwin', phoneDisplay: '(555) 010-2013', street: 'Down House Demo Beetle Shed' },
  { fullName: 'Joan of Arc', phoneDisplay: '(555) 010-2014', street: 'Orléans Demo Bastion' },
  { fullName: 'Julius Caesar', phoneDisplay: '(555) 010-2015', street: 'Rubicon Creek Demo Ford' },
  { fullName: 'Socrates', phoneDisplay: '(555) 010-2016', street: 'Agora Demo Stoa' },
  { fullName: 'Hypatia', phoneDisplay: '(555) 010-2017', street: 'Library of Alexandria Demo Wing' },
  { fullName: 'Benjamin Franklin', phoneDisplay: '(555) 010-2018', street: 'Kite and Key Demo Lane' },
  { fullName: 'Catherine the Great', phoneDisplay: '(555) 010-2019', street: 'Winter Palace Demo Foyer' },
  { fullName: 'William Shakespeare', phoneDisplay: '(555) 010-2020', street: 'Globe Theatre Demo Backstage' },
  { fullName: 'Rosa Parks', phoneDisplay: '(555) 010-2021', street: 'Bus Stop Demo Memorial' },
  { fullName: 'Alan Turing', phoneDisplay: '(555) 010-2022', street: 'Bletchley Park Demo Hut' },
  { fullName: 'Amelia Earhart', phoneDisplay: '(555) 010-2023', street: 'Runway 27 Demo Tarmac' },
  { fullName: 'Sojourner Truth', phoneDisplay: '(555) 010-2024', street: 'Freedom Demo Courtyard' },
  { fullName: 'Mark Twain', phoneDisplay: '(555) 010-2025', street: 'Mississippi Riverboat Demo Berth' },
  { fullName: 'Hedy Lamarr', phoneDisplay: '(555) 010-2026', street: 'Frequency Hopping Demo Lab' },
  { fullName: 'Frederick Douglass', phoneDisplay: '(555) 010-2027', street: 'North Star Demo Press' },
  { fullName: 'Harriet Tubman', phoneDisplay: '(555) 010-2028', street: 'Underground Rail Demo Station' },
  { fullName: 'Nikola Tesla', phoneDisplay: '(555) 010-2029', street: 'Wardenclyffe Demo Tower' },
  { fullName: 'Florence Nightingale', phoneDisplay: '(555) 010-2030', street: 'Lamp Ward Demo Crispin' },
  { fullName: 'Mahatma Gandhi', phoneDisplay: '(555) 010-2031', street: 'Salt March Demo Trail' },
  { fullName: 'Vincent van Gogh', phoneDisplay: '(555) 010-2032', street: 'Sunflower Field Demo Path' },
  { fullName: 'Maya Angelou', phoneDisplay: '(555) 010-2033', street: 'Caged Bird Demo Aviary' },
  { fullName: 'Bruce Lee', phoneDisplay: '(555) 010-2034', street: 'Enter the Demo Dojo' },
  { fullName: 'Wolfgang A. Mozart', phoneDisplay: '(555) 010-2035', street: 'Figaro Demo Arcade' },
  { fullName: 'Anne Frank', phoneDisplay: '(555) 010-2036', street: 'Secret Annex Demo Stair' },
  { fullName: 'Grace Hopper', phoneDisplay: '(555) 010-2037', street: 'COBOL Demo Compilers Row' },
  { fullName: 'Desmond Tutu', phoneDisplay: '(555) 010-2038', street: 'Rainbow Nation Demo Square' },
  { fullName: 'Terry Fox', phoneDisplay: '(555) 010-2039', street: 'Marathon of Hope Demo Km' },
  { fullName: 'Katalin Karikó', phoneDisplay: '(555) 010-2040', street: 'mRNA Demo Freezer' },
  { fullName: 'Rumi', phoneDisplay: '(555) 010-2041', street: 'Whirling Demo Courtyard' },
  { fullName: 'Sappho', phoneDisplay: '(555) 010-2042', street: 'Lesbos Lyric Demo Villa' },
  { fullName: 'Confucius', phoneDisplay: '(555) 010-2043', street: 'Analects Demo Schoolyard' },
  { fullName: 'Ovid', phoneDisplay: '(555) 010-2044', street: 'Metamorphoses Demo Scroll Shop' },
  { fullName: 'Pythagoras', phoneDisplay: '(555) 010-2045', street: 'Right Triangle Demo Plaza' },
  { fullName: 'Laozi', phoneDisplay: '(555) 010-2046', street: 'Tao Te Ching Demo Gate' },
  { fullName: 'Zora Neale Hurston', phoneDisplay: '(555) 010-2047', street: 'Eatonville Demo Porch' },
  { fullName: 'James Baldwin', phoneDisplay: '(555) 010-2048', street: 'Fire Next Time Demo Stoop' },
  { fullName: 'Octavia Butler', phoneDisplay: '(555) 010-2049', street: 'Lilith Brood Demo Hatchery' },
  { fullName: 'Ursula K. Le Guin', phoneDisplay: '(555) 010-2050', street: 'Earthsea Demo Quay' },
];
