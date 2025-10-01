// Navigation and Search functionality

class PortfolioApp {
  private currentSection: string = 'home';
  private allCards: NodeListOf<Element>;
  private sections: string[] = ['home', 'music', 'work', 'stanford', 'hobbies'];
  private currentIndex: number = 0;
  private searchTimeout: NodeJS.Timeout | null = null;
  private isSearching: boolean = false;

  constructor() {
    this.allCards = document.querySelectorAll('.content-card');
    this.setupNavigation();
    this.setupSearch();
    this.setupPlayer();
    this.setupPlaylistCards();
    this.setupHomeButton();
    this.setupBrightness();
    
    // Initialize player with home state
    this.updatePlayerTitle('Home');
  }

  private setupNavigation(): void {
    const navItems = document.querySelectorAll('.nav-item');
    
    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const category = (item as HTMLElement).dataset.category;
        
        if (category) {
          this.switchSection(category);
          
          // Update active state
          navItems.forEach(nav => nav.classList.remove('active'));
          item.classList.add('active');
        }
      });
    });
  }

  private switchSection(sectionName: string): void {
    this.currentSection = sectionName;
    this.currentIndex = this.sections.indexOf(sectionName);
    
    // Hide all sections
    const sections = document.querySelectorAll('.content-section');
    sections.forEach(section => section.classList.remove('active'));
    
    // Show target section
    const targetSection = document.getElementById(`${sectionName}-section`);
    if (targetSection) {
      targetSection.classList.add('active');
    }
    
    // Update player title
    this.updatePlayerTitle(sectionName);
    
    // Clear search
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    if (searchInput) {
      searchInput.value = '';
    }
    
    // Update nav active state
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(nav => {
      const category = (nav as HTMLElement).dataset.category;
      if (category === sectionName) {
        nav.classList.add('active');
      } else {
        nav.classList.remove('active');
      }
    });
  }

  private updatePlayerTitle(title: string): void {
    const playerTitle = document.getElementById('player-title');
    const playerImage = document.getElementById('player-image') as HTMLImageElement;
    
    if (playerTitle) {
      playerTitle.textContent = title;
    }
    
    // Update player image based on section
    if (playerImage) {
      const currentSection = this.currentSection.toLowerCase();
      
      const imageMap: { [key: string]: string } = {
        'home': '/house-playlist.png',
        'music': '/music-playlist.png',
        'work': '/work-playlist.png',
        'stanford': '/stanford-playlist.png',
        'hobbies': '/interest-playlist.png'
      };
      
      playerImage.src = imageMap[currentSection] || '/music-playlist.png';
    }
    
    // Update progress bar
    this.updateProgressBar();
  }

  private updateProgressBar(): void {
    const progressFill = document.getElementById('progress-bar-fill');
    const timeCurrent = document.getElementById('time-current');
    
    if (!progressFill || !timeCurrent) return;
    
    // Each section = 12 seconds, total = 60 seconds (1 minute)
    const secondsPerSection = 12;
    const currentSeconds = this.currentIndex * secondsPerSection;
    const totalSeconds = 60;
    const percentage = (currentSeconds / totalSeconds) * 100;
    
    // Update progress bar
    progressFill.style.width = `${percentage}%`;
    
    // Update time display
    const minutes = Math.floor(currentSeconds / 60);
    const seconds = currentSeconds % 60;
    timeCurrent.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  private setupSearch(): void {
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    const searchResults = document.getElementById('search-results');
    const searchResultsGrid = document.getElementById('search-results-grid');
    
    if (!searchInput || !searchResults || !searchResultsGrid) return;

    const performSearch = (query: string) => {
      // Clear results immediately
      searchResultsGrid.innerHTML = '';
      
      if (query === '') {
        searchResults.classList.remove('active');
        const currentSection = document.getElementById(`${this.currentSection}-section`);
        if (currentSection) {
          currentSection.classList.add('active');
        }
        return;
      }
      
      // Show search results section
      const sections = document.querySelectorAll('.content-section');
      sections.forEach(section => section.classList.remove('active'));
      searchResults.classList.add('active');
      
      // Search and display
      const results = this.searchCards(query);
      this.displaySearchResults(results, searchResultsGrid);
    };

    searchInput.addEventListener('input', (e) => {
      const query = (e.target as HTMLInputElement).value.toLowerCase().trim();
      
      // Clear previous timeout
      if (this.searchTimeout) {
        clearTimeout(this.searchTimeout);
      }
      
      // Debounce search
      this.searchTimeout = setTimeout(() => {
        performSearch(query);
      }, 150);
    });
  }

  private searchCards(query: string): Element[] {
    const results: Element[] = [];
    
    // Search through each section
    const sections = ['music', 'work', 'stanford', 'hobbies'];
    
    sections.forEach(sectionName => {
      const section = document.getElementById(`${sectionName}-section`);
      if (!section) return;
      
      const listItems = section.querySelectorAll('.list-item');
      
      listItems.forEach(item => {
        const title = item.querySelector('.item-name')?.textContent?.toLowerCase() || '';
        const description = item.querySelector('.item-artist')?.textContent?.toLowerCase() || '';
        const tags = (item as HTMLElement).dataset.tags?.toLowerCase() || '';
        
        if (title.includes(query) || description.includes(query) || tags.includes(query)) {
          // Clone the item and add section info
          const clone = item.cloneNode(true) as HTMLElement;
          clone.dataset.section = sectionName;
          results.push(clone);
        }
      });
    });
    
    return results;
  }

  private displaySearchResults(results: Element[], resultsContainer: HTMLElement): void {
    // Force clear all content first
    while (resultsContainer.firstChild) {
      resultsContainer.removeChild(resultsContainer.firstChild);
    }
    
    if (results.length === 0) {
      resultsContainer.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 48px; color: var(--text-secondary);">
          <p style="font-size: 18px;">No results found</p>
          <p style="font-size: 14px; margin-top: 8px;">Try searching for something else</p>
        </div>
      `;
    } else {
      // Create a document fragment to batch DOM updates
      const fragment = document.createDocumentFragment();
      results.forEach(item => {
        const clone = item.cloneNode(true) as HTMLElement;
        
        // Add section badge
        const sectionName = clone.dataset.section;
        if (sectionName) {
          const artistSpan = clone.querySelector('.item-artist');
          if (artistSpan) {
            const sectionBadge = document.createElement('span');
            sectionBadge.className = 'section-badge';
            sectionBadge.textContent = sectionName.charAt(0).toUpperCase() + sectionName.slice(1);
            artistSpan.appendChild(document.createTextNode(' • '));
            artistSpan.appendChild(sectionBadge);
          }
        }
        
        fragment.appendChild(clone);
      });
      resultsContainer.appendChild(fragment);
    }
  }

  private setupPlayer(): void {
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        this.navigatePrevious();
      });
    }
    
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        this.navigateNext();
      });
    }
  }

  private navigatePrevious(): void {
    const newIndex = (this.currentIndex - 1 + this.sections.length) % this.sections.length;
    const newSection = this.sections[newIndex];
    this.switchSection(newSection);
  }

  private navigateNext(): void {
    const newIndex = (this.currentIndex + 1) % this.sections.length;
    const newSection = this.sections[newIndex];
    this.switchSection(newSection);
  }

  private setupPlaylistCards(): void {
    const playlistCards = document.querySelectorAll('.playlist-card');
    
    playlistCards.forEach(card => {
      card.addEventListener('click', () => {
        const category = (card as HTMLElement).dataset.category;
        if (category) {
          this.switchSection(category);
        }
      });
    });
  }

  private setupHomeButton(): void {
    const homeBtn = document.getElementById('home-btn');
    
    if (homeBtn) {
      homeBtn.addEventListener('click', () => {
        this.switchSection('home');
      });
    }
  }

  private setupBrightness(): void {
    const brightnessTrack = document.querySelector('.brightness-track');
    const brightnessFill = document.getElementById('brightness-fill');
    const brightnessBtn = document.getElementById('brightness-btn');
    
    if (!brightnessTrack || !brightnessFill || !brightnessBtn) return;
    
    let brightness = 0; // 0 = dark (default), 100 = bright
    
    // Click on slider to set brightness
    brightnessTrack.addEventListener('click', (event) => {
      const e = event as MouseEvent;
      const rect = (brightnessTrack as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const width = rect.width;
      
      // Calculate brightness from left to right
      brightness = Math.max(0, Math.min(100, (x / width) * 100));
      
      // Update slider fill
      brightnessFill.style.width = `${brightness}%`;
      
      // Apply brightness to website
      this.applyBrightness(brightness);
    });
    
    // Click on icon to reset to default (dark)
    brightnessBtn.addEventListener('click', () => {
      brightness = 0;
      brightnessFill.style.width = '0%';
      this.applyBrightness(0);
    });
  }

  private applyBrightness(brightness: number): void {
    const root = document.documentElement;
    const lightness = brightness / 100;
    
    // Background colors - from dark to light
    const bgPrimary = this.interpolateColor('#121212', '#ffffff', lightness);
    const bgSecondary = this.interpolateColor('#1a1a1a', '#f5f5f5', lightness);
    const bgElevated = this.interpolateColor('#282828', '#ffffff', lightness);
    const bgCard = this.interpolateColor('#1a1a1a', '#f0f0f0', lightness);
    
    // Text colors - from light to dark
    const textPrimary = this.interpolateColor('#ffffff', '#000000', lightness);
    const textSecondary = this.interpolateColor('#b3b3b3', '#666666', lightness);
    
    // Icon colors - SVG strokes
    const iconColor = this.interpolateColor('#ffffff', '#000000', lightness);
    
    // Border colors
    const borderColor = lightness > 0.5 
      ? `rgba(0, 0, 0, ${0.1 * lightness})` 
      : `rgba(255, 255, 255, ${0.1 * (1 - lightness)})`;
    
    root.style.setProperty('--bg-primary', bgPrimary);
    root.style.setProperty('--bg-secondary', bgSecondary);
    root.style.setProperty('--bg-elevated', bgElevated);
    root.style.setProperty('--bg-card', bgCard);
    root.style.setProperty('--text-primary', textPrimary);
    root.style.setProperty('--text-secondary', textSecondary);
    
    // Update body
    document.body.style.backgroundColor = bgPrimary;
    
    // Update sidebar
    const sidebar = document.querySelector('.sidebar') as HTMLElement;
    if (sidebar) {
      sidebar.style.backgroundColor = bgSecondary;
    }
    
    // Update top bar
    const topBar = document.querySelector('.top-bar') as HTMLElement;
    if (topBar) {
      topBar.style.backgroundColor = bgElevated;
      topBar.style.borderBottom = `1px solid ${borderColor}`;
    }
    
    // Update player bar
    const playerBar = document.querySelector('.player-bar') as HTMLElement;
    if (playerBar) {
      playerBar.style.backgroundColor = bgElevated;
      playerBar.style.borderTop = `1px solid ${borderColor}`;
    }
    
    // Update all SVG icons (buttons, nav items, etc.)
    const svgs = document.querySelectorAll('svg');
    svgs.forEach(svg => {
      // Skip the Spotify green accent icon
      if (!svg.closest('.now-playing')) {
        svg.style.color = iconColor;
        svg.style.stroke = iconColor;
        svg.style.fill = svg.getAttribute('fill') === 'currentColor' ? iconColor : '';
      }
    });
    
    // Update play/pause button specifically
    const playBtn = document.getElementById('play-btn');
    if (playBtn) {
      playBtn.style.backgroundColor = textPrimary;
      const playSvg = playBtn.querySelector('svg');
      if (playSvg) {
        playSvg.style.color = bgPrimary;
        playSvg.style.fill = bgPrimary;
      }
    }
    
    // Update home button
    const homeBtn = document.getElementById('home-btn');
    if (homeBtn) {
      homeBtn.style.backgroundColor = bgCard;
      const homeSvg = homeBtn.querySelector('svg');
      if (homeSvg) {
        homeSvg.style.color = iconColor;
        homeSvg.style.stroke = iconColor;
      }
    }
    
    // Update search input
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    if (searchInput) {
      searchInput.style.backgroundColor = bgCard;
      searchInput.style.color = textPrimary;
      searchInput.style.borderColor = borderColor;
    }
    
    // Update content cards
    const cards = document.querySelectorAll('.content-card');
    cards.forEach(card => {
      (card as HTMLElement).style.backgroundColor = bgCard;
    });
    
    // Update playlist headers - make gradients more opaque in light mode
    const playlistHeaders = document.querySelectorAll('.playlist-header');
    playlistHeaders.forEach(header => {
      const parent = header.parentElement;
      if (parent) {
        const parentId = parent.id;
        
        // Adjust gradient opacity based on light mode
        if (lightness > 0.5) {
          // Light mode - make gradients more saturated and opaque
          if (parentId === 'music-section') {
            (header as HTMLElement).style.background = 'linear-gradient(180deg, rgba(29, 185, 84, 0.9) 0%, rgba(29, 185, 84, 0.2) 100%)';
          } else if (parentId === 'work-section') {
            (header as HTMLElement).style.background = 'linear-gradient(180deg, rgba(91, 154, 160, 0.9) 0%, rgba(91, 154, 160, 0.2) 100%)';
          } else if (parentId === 'stanford-section') {
            (header as HTMLElement).style.background = 'linear-gradient(180deg, rgba(140, 21, 21, 0.9) 0%, rgba(140, 21, 21, 0.2) 100%)';
          } else if (parentId === 'hobbies-section') {
            (header as HTMLElement).style.background = 'linear-gradient(180deg, rgba(217, 70, 166, 0.9) 0%, rgba(217, 70, 166, 0.2) 100%)';
          }
          
          // Ensure text is white on colored backgrounds
          const playlistLabel = header.querySelector('.playlist-label') as HTMLElement;
          const playlistTitle = header.querySelector('.playlist-title') as HTMLElement;
          const playlistMeta = header.querySelector('.playlist-meta') as HTMLElement;
          
          if (playlistLabel) playlistLabel.style.color = '#ffffff';
          if (playlistTitle) playlistTitle.style.color = '#ffffff';
          if (playlistMeta) playlistMeta.style.color = 'rgba(255, 255, 255, 0.8)';
        } else {
          // Dark mode - reset to default
          (header as HTMLElement).style.background = '';
          const playlistLabel = header.querySelector('.playlist-label') as HTMLElement;
          const playlistTitle = header.querySelector('.playlist-title') as HTMLElement;
          const playlistMeta = header.querySelector('.playlist-meta') as HTMLElement;
          
          if (playlistLabel) playlistLabel.style.color = '';
          if (playlistTitle) playlistTitle.style.color = '';
          if (playlistMeta) playlistMeta.style.color = '';
        }
      }
    });
  }

  private interpolateColor(color1: string, color2: string, factor: number): string {
    const hex1 = color1.replace('#', '');
    const hex2 = color2.replace('#', '');
    
    const r1 = parseInt(hex1.substring(0, 2), 16);
    const g1 = parseInt(hex1.substring(2, 4), 16);
    const b1 = parseInt(hex1.substring(4, 6), 16);
    
    const r2 = parseInt(hex2.substring(0, 2), 16);
    const g2 = parseInt(hex2.substring(2, 4), 16);
    const b2 = parseInt(hex2.substring(4, 6), 16);
    
    const r = Math.round(r1 + (r2 - r1) * factor);
    const g = Math.round(g1 + (g2 - g1) * factor);
    const b = Math.round(b1 + (b2 - b1) * factor);
    
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new PortfolioApp();
  });
} else {
  new PortfolioApp();
}
