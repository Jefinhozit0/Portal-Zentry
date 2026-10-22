import { Home } from "lucide-react";
import { useLocation } from "wouter";
import { ZentryLogo } from "@/components/ZentryLogo";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function NotFound() {
  const [, setLocation] = useLocation();

  const handleGoHome = () => {
    setLocation("/");
  };

  return (
    <main className="client-portal-center">
      <ThemeToggle className="login-theme-toggle" />
      <div className="login-panel-inner">
        <ZentryLogo size="md" />

        <span className="not-found-code" aria-hidden="true">404</span>

        <h2>Página não encontrada</h2>

        <p className="login-subtitle">
          Não encontramos a página que você procurou.
          <br />
          Confira o endereço ou volte para o início.
        </p>

        <div id="not-found-button-group" className="not-found-actions">
          <button type="button" onClick={handleGoHome} className="primary-button login-button">
            Voltar ao início
            <Home size={18} />
          </button>
        </div>
      </div>
    </main>
  );
}
