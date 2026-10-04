/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		fontFamily: {
  			sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
  			serif: ['"Instrument Serif"', 'ui-serif', 'Georgia', 'serif']
  		},
  		colors: {
  			// Delta brand. `blue` and `indigo` are re-tuned to the Delta navy so
  			// every existing page picks up the brand without per-page edits.
  			brand: {
  				navy: '#002950',
  				ink: '#001a33',
  				cyan: '#1ED2DE',
  				mint: '#7CF0B5'
  			},
  			blue: {
  				50: '#eff7fd', 100: '#dbecf9', 200: '#bfdcf3', 300: '#93c4ea', 400: '#5fa4dc',
  				500: '#3a86cb', 600: '#1f6aae', 700: '#18558e', 800: '#154676', 900: '#0f3862', 950: '#002950'
  			},
  			indigo: {
  				50: '#eef4fa', 100: '#d8e5f2', 200: '#b3cbe4', 300: '#83a7cf', 400: '#5580b5',
  				500: '#35629a', 600: '#1d4a80', 700: '#153b69', 800: '#0e3057', 900: '#082645', 950: '#031a32'
  			},
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			},
  			'bell-ring': {
  				'0%, 100%': { transform: 'rotate(0deg)' },
  				'15%': { transform: 'rotate(14deg)' },
  				'30%': { transform: 'rotate(-12deg)' },
  				'45%': { transform: 'rotate(9deg)' },
  				'60%': { transform: 'rotate(-6deg)' },
  				'75%': { transform: 'rotate(3deg)' }
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out',
  			'bell-ring': 'bell-ring 0.9s ease-in-out 2'
  		},
  		backgroundImage: {
  			'brand-gradient': 'linear-gradient(90deg, #1ED2DE 0%, #7CF0B5 100%)',
  			'navy-gradient': 'linear-gradient(135deg, #002950 0%, #00396b 55%, #0a4d80 100%)'
  		},
  		boxShadow: {
  			soft: '0 1px 2px rgba(0,41,80,0.04), 0 4px 16px -4px rgba(0,41,80,0.08)',
  			lift: '0 2px 4px rgba(0,41,80,0.05), 0 16px 40px -12px rgba(0,41,80,0.18)',
  			glow: '0 8px 30px -8px rgba(30,210,222,0.55)'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
}