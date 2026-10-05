/**
 * Placeholder copy, in two languages.
 *
 * Ported from the generator at thescottkrause.com/devtoys/lorem_ipsum_generator: the
 * Latin bank is the vocabulary of Cicero's *De finibus* that classical lorem ipsum is
 * drawn from, and the English bank is business-speak — the register real product copy
 * is written in, which makes it far better than Latin for judging whether a layout
 * survives the text it will actually hold.
 *
 * Pure and DOM-free, so it is useful well beyond the custom element: seeding a mock
 * chat, filling a fixture, or stress-testing a column width.
 */

/** Cicero, *De finibus bonorum et malorum* — the source of classical lorem ipsum. */
const LATIN = `
  lorem ipsum a ab accusamus accusantium ad adipiscing alias aliquam aliquid amet animi
  aperiam architecto asperiores aspernatur assumenda at atque aut autem beatae blanditiis
  commodi consectetur consequatur consequuntur corporis corrupti culpa cum cumque cupiditate
  debitis delectus deleniti deserunt dicta dignissimos distinctio do dolor dolore dolorem
  doloremque dolores doloribus dolorum dquis ducimus ea eaque earum eius eligendi enim eos
  error ert esse est et eum eveniet ex excepturi exercitationem expedita explicabo facere
  facilis fuga fugiat fugit harum hic id illo illum impedit in incididunt inventore ipsa ipsam
  irure iste itaque iusto labore laboriosam laborum laudantium libero magnam magni maiores
  maxime minima minus modi molestiae molestias mollitia nam natus necessitatibus nemo neque
  nesciunt nihil nisi nobis non nostrumd nulla numquam obcaecati odio odit officia officiis
  omnis optio pariatur perferendis perspiciatis placeat porro possimus praesentium provident
  quae quaerat quam quas quasi qui quia quibusdam quidem quis quisquam quo quod quos ratione
  recusandae reiciendis rem repellat repellendaus reprehenderit repudiandae rerudum rerum
  saepe sapiente sed sequi similique sint sit soluta sunt suscipit tempora tempore temporibus
  tenetur totam ullam unde ut vel velit veniam veritatis vero vitae voluptas voluptate
  voluptatem voluptates voluptatibus voluptatum
`.trim().split(/\s+/);

/** Business-speak. Deliberately includes the long words that break layouts. */
const BUSINESS = `
  a about absolutely accident action actionology admirable advocacy alchemy all an and angel
  animals anime answer anywhere application apprehension are arrester artisanal as asked atoms
  avant-garde awareness back bamboozle bananas based beauty best beyond blink bold book boost
  boy boys brand brandformance brands breakfast build but butterscotch buyer buyers by cadence
  can candy cash cellaphane centricity chain chaos claironic clarity clever clevor
  clevorvoyant clock clockwork coming common compass compel consensus contagious content
  context convergence conversational conviction convinced countenance counter crackerjack
  craftwork create creating crucial culture customer cut cutting damn data day decisis
  delirious delta depth design destroyed digital directed discerning discoverability
  distinctly doctor dog’s don't done doppelganger double dubious dust easy eat efficiency
  elastic electrokinetic emerging enablement enemy engage enigmatic enliven enterprise entice
  etch even every evocative evoked experience express extremely eyes faculties fad fall fast
  feasible ferver fishstick flow fluent fluid fly food for foray form freak fresh fringe from
  fruition fulcrum fundamental fusion future-proof game garish generation give glide glory
  gobsmackingly god golden gotta grokked grow guile hand happenstance he's heart help here
  high hold honey how however hyper-persuasive i iconic ideas ideation if imagine
  impossibilities in indigo infinite insipid into intuitive ion irrepressibly is isn’t it it's
  journeys joy keystone knot know latticework laureate leading-edge leapyear lengths let life
  like linchpin longing luxe madness majestic man many marketing me meaningful microsecond
  minds monkeys moonlight motion move movie moving my needle nevermore new noble noise
  nonsense not numbers observable of on once orgin other our outcome-based own page paragon
  pay pepper peppercoin physically piece pimento poet portal posh post potential probability
  product productivity propulsion purple quantum questions quinque quintessence rancid reason
  reasonable refreshingly reliable replicating required resonance results revenue reversed
  ridiculous right rise rocket salesforce saw say scalable score sculptor secure see seize
  sell seller sense shakespeare shoes single small smart socks sorrow stainless stars
  steadfast story straight strawberry striking studio sub-committee sunset surgery syncopated
  syncopation syndication take tech technology tell that the thee their theory there they this
  those through time to trebuchet trillions typing uncommon unexpected unfathomably universe
  unreasonable urgency use vantagepoint veins versus vessel video visualization visualizer
  visuals want was watch way were what wherewithal wind wine wise with within won't words work
  world yet you you'd your zenith
`.trim().split(/\s+/);

/** Exposed so a caller can inspect or extend the vocabulary. */
export const WORD_BANKS = Object.freeze({
  latin: Object.freeze(LATIN),
  english: Object.freeze(BUSINESS)
});

export const LANGUAGES = Object.freeze(Object.keys(WORD_BANKS));

/** The opening everyone recognises, so Latin output reads as placeholder copy. */
const CLASSIC_OPENING = ['lorem', 'ipsum', 'dolor', 'sit', 'amet'];

/**
 * Deterministic PRNG (mulberry32), used only when a seed is supplied.
 *
 * A seed matters more than it looks: without one, a test can only assert shape,
 * and a page regenerates different copy on every render — which turns a visual
 * diff into noise and makes a screenshot worthless as a regression check.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * Generates placeholder copy.
 *
 * @param {object} [options]
 * @param {number} [options.sentences=5]  Sentences per paragraph. -1 picks 1-5 at random.
 * @param {number} [options.paragraphs=1] Paragraphs, joined by a blank line.
 * @param {'latin'|'english'} [options.lang='latin']
 * @param {number} [options.minWords=5]   Fewest words in a sentence.
 * @param {number} [options.maxWords=14]  Most words in a sentence.
 * @param {number} [options.seed]         Omit for random output; supply for repeatable.
 * @param {boolean} [options.classicOpening] Start Latin with "Lorem ipsum dolor sit amet".
 * @returns {string}
 */
export function loremIpsum({
  sentences = 5,
  paragraphs = 1,
  lang = 'latin',
  minWords = 5,
  maxWords = 14,
  seed,
  classicOpening
} = {}) {
  const bank = WORD_BANKS[lang];
  if (!bank) throw new TypeError(`lang must be one of ${LANGUAGES.join(', ')}`);

  const random = seed === undefined ? Math.random : mulberry32(seed);
  const between = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));

  const low = Math.max(1, Math.min(minWords, maxWords));
  const high = Math.max(low, maxWords);
  const openWithClassic = classicOpening ?? lang === 'latin';

  const out = [];
  let isFirstSentence = true;

  for (let p = 0; p < Math.max(1, paragraphs); p++) {
    // -1 keeps parity with the original tool, where it meant "surprise me".
    const count = sentences === -1 ? between(1, 5) : Math.max(1, sentences);
    const built = [];

    for (let s = 0; s < count; s++) {
      const target = between(low, high);
      // Per sentence, not globally: repeating a word across a long passage is
      // what real prose does, and forbidding it thins the vocabulary to nothing.
      const used = new Set();
      const words = [];

      if (isFirstSentence && openWithClassic) {
        for (const word of CLASSIC_OPENING.slice(0, target)) {
          words.push(word);
          used.add(word);
        }
      }

      // Bounded attempts rather than `while (words.length < target)`: with a small
      // bank and a large target, exact-word dedupe can otherwise never terminate.
      for (let attempt = 0; words.length < target && attempt < target * 8; attempt++) {
        const word = bank[Math.floor(random() * bank.length)];
        if (used.has(word)) continue;
        used.add(word);
        words.push(word);
      }

      words[0] = capitalize(words[0]);
      built.push(`${words.join(' ')}.`);
      isFirstSentence = false;
    }

    out.push(built.join(' '));
  }

  return out.join('\n\n');
}

/** A single sentence. Convenient for titles, labels and chat one-liners. */
export const loremSentence = (options = {}) => loremIpsum({ ...options, sentences: 1, paragraphs: 1 });
