export component Logomark(className: string = '') {
  render (
    <svg aria-hidden="true" viewBox="0 0 36 36" fill="none" class={className}>
      <g fill="none" stroke="#38BDF8" stroke-linejoin="round" stroke-width="3">
        <path d="M10.308 5L18 17.5 10.308 30 2.615 17.5 10.308 5z" />
        <path d="M18 17.5L10.308 5h15.144l7.933 12.5M18 17.5h15.385L25.452 30H10.308L18 17.5z" />
      </g>
    </svg>
  )
}

export component Logo(className: string = '') {
  render (
    <svg aria-hidden="true" viewBox="0 0 100 36" fill="none" class={className}>
      <g fill="none" stroke="#38BDF8" stroke-linejoin="round" stroke-width="3">
        <path d="M10.308 5L18 17.5 10.308 30 2.615 17.5 10.308 5z" />
        <path d="M18 17.5L10.308 5h15.144l7.933 12.5M18 17.5h15.385L25.452 30H10.308L18 17.5z" />
      </g>
      <text x="45" y="25" class="fill-slate-700 dark:fill-sky-100" font-family="Lexend, system-ui" font-weight="600" font-size="16">DarTsx</text>
    </svg>
  )
}
