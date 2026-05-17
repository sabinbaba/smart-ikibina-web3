// components/PrivyProvider.jsx
import { PrivyProvider } from "@privy-io/react-auth";

export function IkiminaPrivyProvider({ children }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID}  // Get from dashboard.privy.io
      config={{
        // Allow email login - no wallet needed!
        loginMethods: ["email"],
        
        // Create an embedded wallet for every user automatically
        embeddedWallets: {
          createOnLogin: "users-without-wallets",  // Creates wallet for email users
          noPromptOnSignature: true,  // No pop-ups for signatures
        },
        
        appearance: {
          theme: "dark",  // Match your Ikimina theme
          accentColor: "#c9a84c",  // Your gold color!
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}