export const metadata = { title: "Quiz Arena" }
export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning style={{ margin: 0, fontFamily: "Segoe UI, sans-serif", background: "linear-gradient(135deg, #0f0c29, #302b63, #24243e)", minHeight: "100vh", color: "white" }}>
        {children}
      </body>
    </html>
  )
}
