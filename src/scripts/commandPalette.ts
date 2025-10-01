// Command Palette (Cmd+K)

interface Command {
  name: string;
  description: string;
  action: () => void;
  keywords: string[];
}

class CommandPalette {
  private isOpen: boolean = false;
  private overlay: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private resultsList: HTMLElement | null = null;
  private commands: Command[] = [];
  private filteredCommands: Command[] = [];
  private selectedIndex: number = 0;

  constructor() {
    this.setupCommands();
    this.createPalette();
    this.setupKeyboardShortcuts();
  }

  private setupCommands(): void {
    this.commands = [
      {
        name: 'Go to Home',
        description: 'Navigate to home section',
        action: () => this.navigateTo('home'),
        keywords: ['home', 'main', 'start']
      },
      {
        name: 'Go to Music',
        description: 'View music projects',
        action: () => this.navigateTo('music'),
        keywords: ['music', 'songs', 'tracks', 'spotify']
      },
      {
        name: 'Go to Work',
        description: 'View work experience',
        action: () => this.navigateTo('work'),
        keywords: ['work', 'job', 'experience', 'internship']
      },
      {
        name: 'Go to Stanford',
        description: 'View Stanford activities',
        action: () => this.navigateTo('stanford'),
        keywords: ['stanford', 'school', 'university', 'education']
      },
      {
        name: 'Go to Hobbies',
        description: 'View hobbies and interests',
        action: () => this.navigateTo('hobbies'),
        keywords: ['hobbies', 'interests', 'fun', 'games']
      },
      {
        name: 'Toggle Light Mode',
        description: 'Switch between dark and light mode',
        action: () => this.toggleBrightness(),
        keywords: ['theme', 'dark', 'light', 'mode', 'brightness']
      },
      {
        name: 'Search',
        description: 'Focus search bar',
        action: () => this.focusSearch(),
        keywords: ['search', 'find', 'look']
      },
      {
        name: 'Email Me',
        description: 'Open email client',
        action: () => window.location.href = 'mailto:joshuaykoo@gmail.com',
        keywords: ['email', 'contact', 'message']
      },
      {
        name: 'View LinkedIn',
        description: 'Open LinkedIn profile',
        action: () => window.open('https://www.linkedin.com/in/joshuaykoo/', '_blank'),
        keywords: ['linkedin', 'profile', 'social']
      },
      {
        name: 'View GitHub',
        description: 'Open GitHub profile',
        action: () => window.open('https://github.com/jkdreamr', '_blank'),
        keywords: ['github', 'code', 'projects']
      }
    ];
  }

  private createPalette(): void {
    const overlay = document.createElement('div');
    overlay.id = 'command-palette-overlay';
    overlay.innerHTML = `
      <div class="command-palette">
        <div class="command-search">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.35-4.35"></path>
          </svg>
          <input type="text" placeholder="Type a command or search..." id="command-input" autocomplete="off" />
          <kbd>ESC</kbd>
        </div>
        <div class="command-results" id="command-results"></div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    this.overlay = overlay;
    this.input = document.getElementById('command-input') as HTMLInputElement;
    this.resultsList = document.getElementById('command-results');

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    // Handle input
    this.input?.addEventListener('input', () => this.handleInput());
    this.input?.addEventListener('keydown', (e) => this.handleKeydown(e));
  }

  private setupKeyboardShortcuts(): void {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        this.toggle();
      }
      
      // ESC to close
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
  }

  private toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  private open(): void {
    this.isOpen = true;
    this.overlay?.classList.add('active');
    this.input?.focus();
    this.filteredCommands = this.commands;
    this.renderResults();
  }

  private close(): void {
    this.isOpen = false;
    this.overlay?.classList.remove('active');
    if (this.input) this.input.value = '';
    this.selectedIndex = 0;
  }

  private handleInput(): void {
    const query = this.input?.value.toLowerCase() || '';
    
    if (!query) {
      this.filteredCommands = this.commands;
    } else {
      this.filteredCommands = this.commands.filter(cmd => 
        cmd.name.toLowerCase().includes(query) ||
        cmd.description.toLowerCase().includes(query) ||
        cmd.keywords.some(k => k.includes(query))
      );
    }
    
    this.selectedIndex = 0;
    this.renderResults();
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIndex = Math.min(this.selectedIndex + 1, this.filteredCommands.length - 1);
      this.renderResults();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
      this.renderResults();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.executeCommand(this.selectedIndex);
    }
  }

  private renderResults(): void {
    if (!this.resultsList) return;
    
    if (this.filteredCommands.length === 0) {
      this.resultsList.innerHTML = '<div class="command-empty">No commands found</div>';
      return;
    }
    
    this.resultsList.innerHTML = this.filteredCommands.map((cmd, index) => `
      <div class="command-item ${index === this.selectedIndex ? 'selected' : ''}" data-index="${index}">
        <div class="command-item-content">
          <div class="command-item-name">${cmd.name}</div>
          <div class="command-item-description">${cmd.description}</div>
        </div>
        <kbd>↵</kbd>
      </div>
    `).join('');

    // Add click handlers
    this.resultsList.querySelectorAll('.command-item').forEach((item, index) => {
      item.addEventListener('click', () => this.executeCommand(index));
    });
  }

  private executeCommand(index: number): void {
    const command = this.filteredCommands[index];
    if (command) {
      command.action();
      this.close();
    }
  }

  private navigateTo(section: string): void {
    const navItem = document.querySelector(`[data-category="${section}"]`) as HTMLElement;
    navItem?.click();
  }

  private toggleBrightness(): void {
    const brightnessBtn = document.getElementById('brightness-btn');
    brightnessBtn?.click();
  }

  private focusSearch(): void {
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    searchInput?.focus();
  }
}

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new CommandPalette());
} else {
  new CommandPalette();
}
