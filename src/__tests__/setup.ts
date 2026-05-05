import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement scrollIntoView; components that auto-scroll
// (e.g. AgentMeeting messages list) call it during effects and would
// otherwise crash the test render.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {
    /* noop in tests */
  };
}
