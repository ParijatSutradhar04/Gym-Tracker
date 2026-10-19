/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: '#101211',
        surface: '#1B1E1C',
        'surface-2': '#252925',
        border: '#323732',
        ink: '#F4F6F1',
        muted: '#9BA39A',
        faint: '#697268',
        accent: '#C5F76B',
        'on-accent': '#17200D',
      },
      fontFamily: {
        sans: ['Inter_400Regular'],
        'sans-medium': ['Inter_500Medium'],
        'sans-semibold': ['Inter_600SemiBold'],
        mono: ['RobotoMono_400Regular'],
        'mono-medium': ['RobotoMono_500Medium'],
      },
    },
  },
  plugins: [],
};
