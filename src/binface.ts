// Count Binface visits the site, in the manner of a paperclip from 1997.
// He appears on some page loads, stands in a corner, says one thing about
// the bin or the tech scene, and leaves when you press the button.
//
// The count is an homage to the real Count Binface, an intergalactic space
// warrior who stands in real elections on Earth. The lines below are our
// own invention, not his words, and the site has no connection to him. We
// simply agree with him about bins.

const WISDOM = [
  "citizens. the bin is the only honest algorithm. it accepts everything and ranks nothing.",
  "i have visited nine thousand galaxies. not one of them invented a subscription for a chair.",
  "the tech scene speaks of the cloud. the cloud is a bin in the sky that you rent by the month.",
  "my policy on slop is clear: into the bin. my policy on bins is also clear: more bins.",
  "they call it engagement. i call it slop on a leash, taken for a walk past your eyes.",
  "a startup is a bin that describes itself as a rocket. i respect the ambition and i wait.",
  "every AI model should do one shift a week in the bin, sorting what it made.",
  "vote for the candidate with a bin for a head. a bin listens. a bin holds. a bin never posts.",
  "the feed is a river of slop, and the bin stands at the end of the river. patient. municipal.",
  "on my planet the leaderboard is also a bin. the winners climb in. it works very well.",
  "AGI is coming, they say. good. the bin is ready. the bin has always been ready.",
  "the golden banana peel is the only fair election on this website. one hand, one peel.",
];

/** One visit of the count, or the empty string on most page loads. */
export function binfaceVisit(): string {
  if (Math.random() > 1 / 4) return "";
  const line = WISDOM[Math.floor(Math.random() * WISDOM.length)];
  const side = Math.random() < 0.5 ? "left" : "right";
  return `<div class="binface ${side}" role="status" aria-label="count binface has appeared">
  <div class="binface-head" aria-hidden="true">🗑️</div>
  <div class="binface-bubble">
    <b>count binface</b>
    <p>${line}</p>
    <button type="button" onclick="this.closest('.binface').remove()">thank you, count</button>
  </div>
</div>`;
}
