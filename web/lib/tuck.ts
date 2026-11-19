/** The phone's floating New chat pill: tucked while scrolling down, back on a scroll up or near the top. */
export const tuckNext = (prev: number, y: number, tucked: boolean) =>
  y < 80 ? false : y - prev > 8 ? true : prev - y > 8 ? false : tucked
