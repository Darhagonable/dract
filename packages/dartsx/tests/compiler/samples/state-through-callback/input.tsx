import { effect } from 'dartsx'

function withLogger(value, label) {
  effect(value, (val) => console.log(`[${label}]`, val))
}

function withValidator(value, validate) {
  effect(value, (val) => {
    if (!validate(val)) console.warn('invalid:', val)
  })
}

component Form() {
  state name = ''
  state age = 0

  withLogger(name, 'name')
  withLogger(age, 'age')
  withValidator(name, (v) => v.length > 0)

  render (
    <div>
      <input value={name} />
      <input value={age} type="number" />
    </div>
  )
}
