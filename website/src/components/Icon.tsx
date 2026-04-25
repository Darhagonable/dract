import { InstallationIcon } from './icons/InstallationIcon'
import { LightbulbIcon } from './icons/LightbulbIcon'
import { PluginsIcon } from './icons/PluginsIcon'
import { PresetsIcon } from './icons/PresetsIcon'
import { ThemingIcon } from './icons/ThemingIcon'
import { WarningIcon } from './icons/WarningIcon'

const icons = {
  installation: InstallationIcon,
  presets: PresetsIcon,
  plugins: PluginsIcon,
  theming: ThemingIcon,
  lightbulb: LightbulbIcon,
  warning: WarningIcon,
}

const iconStyles = {
  blue: '[--icon-foreground:theme(colors.slate.900)] [--icon-background:theme(colors.white)]',
  amber:
    '[--icon-foreground:theme(colors.amber.900)] [--icon-background:theme(colors.amber.100)]',
}

export type IconName = keyof typeof icons
export type ColorName = keyof typeof iconStyles

let nextIconId = 0

export component Icon(color: ColorName = 'blue', icon: IconName, className: string = '', ...rest: any[]) {
  const id = `icon-${nextIconId++}`
  let IconComponent = icons[icon]

  render (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 32"
      fill="none"
      class={`${className} ${iconStyles[color]}`}
      {...rest}
    >
      <IconComponent id={id} color={color} />
    </svg>
  )
}

const gradients = {
  blue: [
    { 'stop-color': '#0EA5E9' },
    { 'stop-color': '#22D3EE', offset: '.527' },
    { 'stop-color': '#818CF8', offset: 1 },
  ],
  amber: [
    { 'stop-color': '#FDE68A', offset: '.08' },
    { 'stop-color': '#F59E0B', offset: '.837' },
  ],
}

export component Gradient(color: ColorName = 'blue', ...rest: any[]) {
  render (
    <radialGradient
      cx="0"
      cy="0"
      r="1"
      gradientUnits="userSpaceOnUse"
      {...rest}
    >
      {for (const [i, stop] of gradients[color].entries()) {
        <stop key={i} {...stop} />
      }}
    </radialGradient>
  )
}

export component LightMode(className: string = '', children: any, ...rest: any[]) {
  render <g class={`dark:hidden ${className}`} {...rest}>{children}</g>
}

export component DarkMode(className: string = '', children: any, ...rest: any[]) {
  render <g class={`hidden dark:inline ${className}`} {...rest}>{children}</g>
}
