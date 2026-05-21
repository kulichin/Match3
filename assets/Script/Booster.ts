import GameManager from "./GameManager";

const { ccclass, property, executeInEditMode } = cc._decorator;

enum BoosterMode {
    NONE     = 0,
    BOMB     = 1,
    TELEPORT = 2
}

@ccclass
@executeInEditMode
export default class BoosterItem extends cc.Component {

    @property(cc.SpriteFrame)
    get boosterIconImage(): cc.SpriteFrame {
        return this._boosterIconImage;
    }

    set boosterIconImage(value: cc.SpriteFrame) {
        this._boosterIconImage = value;

        this.updateIcon();
    }

    @property boosterCount: number = 0;
    @property({
        type: cc.Enum(BoosterMode)
    })
    boosterType: BoosterMode = BoosterMode.NONE;

    private _boosterIconImage: cc.SpriteFrame = null;
    private boosterIcon:       cc.Sprite      = null;
    private boosterCountLabel: cc.Label       = null;
	private glowTween:         cc.Tween       = null;
	private isActive:          boolean        = false;

    onLoad() {
        this.findComponents();
        this.updateIcon();
        this.updateCount();

        this.node.on(cc.Node.EventType.TOUCH_END, this.onClick, this);
    }

    start() {
        this.findComponents();
        this.updateIcon();
        this.updateCount();
    }

    onDestroy() {
        this.node.off(cc.Node.EventType.TOUCH_END, this.onClick, this);
    }

    private findComponents() {
        if (!this.boosterIcon) {
            const iconNode = this.node.getChildByName("booster_type_icon");
            if (iconNode) {
                this.boosterIcon = iconNode.getComponent(cc.Sprite);
            }
        }

        if (!this.boosterCountLabel) {
            const countNode = this.node.getChildByName("booster_count");
            if (countNode) {
                this.boosterCountLabel = countNode.getComponent(cc.Label);
            }
        }
    }

    private updateIcon() {
        if (this.boosterIcon && this._boosterIconImage) {
            this.boosterIcon.spriteFrame = this._boosterIconImage;
        }
    }

    private updateCount() {
        if (this.boosterCountLabel) {
            this.boosterCountLabel.string = this.boosterCount.toString();
        }
    }

    public setBoosterIcon(spriteFrame: cc.SpriteFrame) {
        this.boosterIconImage = spriteFrame;
    }

    public setCount(count: number) {
        this.boosterCount = count;
        this.updateCount();
    }
	
	public decrementCount(count: number) {
        this.boosterCount -= 1;
        this.updateCount();
    }

	private startGlowAnimation() {
		if (!this.node) {
			return;
		}
	
		this.stopGlowAnimation();
	
		const target = this.node;
		this.glowTween = cc.tween(target)
			.repeatForever(
				cc.tween()
					.to(0.6, { scale: 1.08 })
					.to(0.6, { scale: 1.0 })
			)
			.start();
	
		// Optional: sprite glow via color pulse
		if (this.boosterIcon) {
			cc.tween(this.boosterIcon)
				.repeatForever(
					cc.tween()
						.to(0.5, { color: new cc.Color(255, 255, 180) })
						.to(0.5, { color: new cc.Color(255, 255, 255) })
				)
				.start();
		}
	}
	
	private stopGlowAnimation() {
		if (this.glowTween) {
			this.glowTween.stop();
			this.glowTween = null;
		}
	
		cc.tween(this.node).stop();
	
		if (this.boosterIcon) {
			cc.tween(this.boosterIcon).stop();
			this.boosterIcon.color = cc.Color.WHITE;
		}
	
		this.node.scale = 1.0;
	}
	
	private playClickAnimation() {
		cc.tween(this.node)
			.stop()
	
		cc.tween(this.node)
			.to(0.08, { scale: 0.9 })
			.to(0.08, { scale: 1.05 })
			.to(0.06, { scale: 1.0 })
			.start();
	}
	
	public setActive(active: boolean) {
		this.isActive = active;
		if (this.isActive) {
			this.startGlowAnimation();
		} else {
			this.stopGlowAnimation();
		}
	}

    private onClick() {
		this.playClickAnimation();
		
		if (this.boosterCount <= 0) {
			return;
		}
		
		this.setActive(!this.isActive);
		
		if (this.isActive) {
			if (this.boosterType == BoosterMode.BOMB) {
				GameManager.singleton.activateBombBooster(this);
			}
			else if (this.boosterType == BoosterMode.TELEPORT) {
				GameManager.singleton.activateTeleportBooster(this);
			}
		} else {
			GameManager.singleton.deactivateBooster();
		}
	}

#if CC_EDITOR
    update() {
        if (!CC_EDITOR) {
			return;
		}

        this.updateIcon();
        this.updateCount();
    }
#endif
}