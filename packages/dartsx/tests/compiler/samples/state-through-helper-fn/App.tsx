import { createLogger, combineSignals } from './helpers'

export component Dashboard() {
  state width = 800
  state height = 600

  const logWidth = createLogger('width')
  logWidth(width)

  derived area = combineSignals(width, height, (w, h) => w * h)

  render (
    <div>
      <p>Size: {width}x{height}</p>
      <p>Area: {area}</p>
      <button onclick={() => width = width + 100}>wider</button>
    </div>
  )
}
