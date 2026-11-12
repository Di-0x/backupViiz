import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Logo } from './Logo';

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const { user } = useAuth();
  return (
    <header className="app-header">
      <Link to="/" className="app-brand" aria-label="BackupViiz — accueil">
        <Logo />
        <span>BackupViiz</span>
      </Link>
      <div className="app-header-slot">{children}</div>
      <nav aria-label="Navigation principale" className="app-nav">
        <NavLink to="/" end>Stratégies</NavLink>
        <NavLink to="/account">{user ? user.username : 'Compte'}</NavLink>
      </nav>
    </header>
  );
}
