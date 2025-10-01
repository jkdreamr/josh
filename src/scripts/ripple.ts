// Ripple Effect on Click

class RippleEffect {
  constructor() {
    this.init();
  }

  private init(): void {
    document.addEventListener('click', (e: MouseEvent) => {
      this.createRipple(e.clientX, e.clientY);
    });
  }

  private createRipple(x: number, y: number): void {
    const ripple = document.createElement('div');
    ripple.className = 'ripple-effect';
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    
    document.body.appendChild(ripple);

    // Remove after animation
    setTimeout(() => {
      ripple.remove();
    }, 1000);
  }
}

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new RippleEffect());
} else {
  new RippleEffect();
}
