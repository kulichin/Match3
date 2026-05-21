import Booster from "./Booster";

const { ccclass, property } = cc._decorator;
 
enum SuperTileType {
    NONE      = -1,
    ROW       = 0,
    COLUMN    = 1,
    RADIUS    = 2,
    ALL_FIELD = 3
}
 
enum BoosterMode {
    NONE     = 0,
    BOMB     = 1,
    TELEPORT = 2
}
 
interface TileData {
    row:       number;
    col:       number;
    color:     number;          // -1 means super tile
    node:      cc.Node;
    superType: SuperTileType;
}
 
@ccclass
export default class GameManager extends cc.Component {
    public static singleton: GameManager = null;
 
    // PROPERTIES
    @property rows:                   number = 8;
    @property cols:                   number = 8;
    @property tileSizeX:              number = 80;
    @property tileSizeY:              number = 80;
    @property targetScore:            number = 3000;
    @property maxMoves:               number = 20;
    @property superTileThreshold:     number = 5;    // Minimum group size to spawn a super tile
    @property bombRadius:             number = 2;    // Radius for BOMB booster and RADIUS super-tile (in cells)
    @property initialSuperTileChance: number = 0.05; // Probability [0..1] that super tile spawned during initial board creation
 
    @property({ type: [cc.SpriteFrame] }) superTile_sprites:       cc.SpriteFrame[] = []; // @NOTE: SuperTiles sprites: 0 - ROW, 1 - COLUMN, 2 - BOMB, 3 - ALL
    @property({ type: [cc.SpriteFrame] }) colored_sprites:         cc.SpriteFrame[] = [];
    @property(cc.Label)                   score_number_text:       cc.Label         = null;
    @property(cc.Label)                   moves_number_text:       cc.Label         = null;
    @property(cc.Prefab)                  tilePrefab:              cc.Prefab        = null;
	@property(cc.Label)                   game_result_text:        cc.Label         = null;
	@property(cc.Label)                   game_result_second_text: cc.Label         = null;
	@property(cc.Node)                    game_result_window:      cc.Node          = null;
 
    // STATES
    private board:                  TileData[][]    = [];
    private score:                  number          = 0;
    private moves:                  number          = 0;
    private pendingOps:             number          = 0;   // >0 means locked
    private shuffleCount:           number          = 0;
    private readonly MAX_SHUFFLES:  number          = 3;
    private boosterMode:            BoosterMode     = BoosterMode.NONE;
	private currentBooster:         Booster         = null;
    private teleportFirst:          TileData | null = null;
    private readonly ANIM_DURATION: number          = 0.2; // Single animation duration used everywhere so tweaks stay in one place

    @property(cc.ParticleAsset)
    particlePrefab: cc.ParticleAsset = null;

	spawnParticleForTile(tileData: TileData) {
		if (!tileData?.node) {
			return;
		}
		
		const palette = [
			new cc.Color(0,   255,   0, 255),   // color 0 — green
			new cc.Color(128, 0,   128, 255),   // color 1 — purple
			new cc.Color(255, 255,   0, 255),   // color 2 — yellow
		];
		const color = palette[tileData.color] ?? new cc.Color(0, 255, 0, 255);
		
		const node = new cc.Node("particle");
		node.zIndex = 10;
		node.setPosition(tileData.node.position);
		this.node.addChild(node);
		
		const ps = node.addComponent(cc.ParticleSystem);
		ps.file           = this.particlePrefab;
		ps.custom         = true;
		ps.duration       = 0.25;
		ps.startSize      = 18 * 4;
		ps.startSizeVar   = 6 * 4;
		ps.startColor     = color;
		ps.endColor       = new cc.Color(color.r, color.g, color.b, 0);
		ps.autoRemoveOnFinish = true;
		ps.resetSystem();
	}

    onLoad() {
        GameManager.singleton = this;
        this.createBoard();
        this.updateScore(0);
    }
 
    // Returns a random SuperTileType based on initialSuperTileChance
    private pickTileTypeForSpawn(): SuperTileType {
        if (Math.random() < this.initialSuperTileChance) {
            const types = [
                SuperTileType.ROW,
                SuperTileType.COLUMN,
                SuperTileType.RADIUS,
                SuperTileType.ALL_FIELD
            ];
            return types[Math.floor(Math.random() * types.length)];
        }
        return SuperTileType.NONE;
    }
 
    createBoard() {
        for (let r = 0; r < this.rows; r++) {
            this.board[r] = [];
            for (let c = 0; c < this.cols; c++) {
                this.createTile(r, c, this.pickTileTypeForSpawn());
            }
        }
    }
 
    createTile(row: number, col: number, superType: SuperTileType = SuperTileType.NONE) {
        const node  = cc.instantiate(this.tilePrefab);
        node.parent = this.node;
 
        const isSuperTile = superType !== SuperTileType.NONE;
        const colorIndex  = isSuperTile ? -1 : Math.floor(Math.random() * this.colored_sprites.length);
        const x           = (col - this.cols / 2) * this.tileSizeX + this.tileSizeX / 2;
        const y           = (this.rows / 2 - row) * this.tileSizeY - this.tileSizeY / 2;
 
        node.setPosition(x, y);
        node.zIndex = this.rows - row;
 
        const sprite = node.getComponent(cc.Sprite);
        if (isSuperTile) {
            sprite.spriteFrame = this.superTile_sprites.length > superType
                ? this.superTile_sprites[superType]
                : this.colored_sprites[0];
        } else {
            sprite.spriteFrame = this.colored_sprites[colorIndex];
            node.color = cc.Color.WHITE;
        }
        node.scale = 1;
 
        const tileData: TileData = { row, col, color: colorIndex, node, superType };
        this.board[row][col] = tileData;
 
        node.on(cc.Node.EventType.TOUCH_END, () => this.onTileClick(tileData));
        return tileData;
    }
 
    ////////////////////////////////////////////////////////////////////
    // Click handling
    //
    async onTileClick(tile: TileData) {
        if (this.pendingOps > 0) {
			return;
		}
 
        // BOOSTER TELEPORT
        if (this.boosterMode === BoosterMode.TELEPORT) {
            if (!this.teleportFirst) {
                this.teleportFirst = tile;
                this.highlightNode(tile.node, true);
                return;
            }
 
            const first        = this.teleportFirst;
            const second       = tile;
            this.highlightNode(first.node, false);
            this.teleportFirst = null;
            this.boosterMode   = BoosterMode.NONE;
			if (this.currentBooster) {
				this.currentBooster.setActive(false);
				this.currentBooster.decrementCount();
			}
 
            if (first !== second) {
                this.pendingOps++;
                await this.swapTiles(first, second);
                this.pendingOps--;
            }
            return;
        }
 
        // BOOSTER BOMB
        if (this.boosterMode === BoosterMode.BOMB) {
            this.boosterMode = BoosterMode.NONE;
            this.pendingOps++;
            this.incrementMoves();
			if (this.currentBooster) {
				this.currentBooster.setActive(false);
				this.currentBooster.decrementCount();
			}
 
            await this.burnRadius(tile.row, tile.col, this.bombRadius);
            await this.collapseAndFill();
            await this.checkEndConditions();
 
            this.pendingOps--;
            return;
        }
 
        // SUPER TILE ACTVIATED
        if (tile.superType !== SuperTileType.NONE) {
            this.pendingOps++;
            this.incrementMoves();
 
            await this.activateSuperTile(tile);
            await this.collapseAndFill();
            await this.checkEndConditions();
 
            this.pendingOps--;
            return;
        }
 
        // JUST TILE
        const group = this.findGroup(tile.row, tile.col, tile.color);
        if (group.length <= 1) {
            cc.log("Cannot destroy single tile");
            return;
        }
 
        this.pendingOps++;
        this.incrementMoves();
 
        const spawnSuper = group.length > this.superTileThreshold;
        const clickedRow = tile.row;
        const clickedCol = tile.col;
        for (const t of group) {
			this.spawnParticleForTile(t);
			
            this.board[t.row][t.col] = null;
            this.animateDestroy(t.node);
        }
        this.updateScore(group.length * 10);
 
        await this.collapseAndFill(spawnSuper ? { row: clickedRow, col: clickedCol } : null);
        await this.checkEndConditions();
 
        this.pendingOps--;
    }
 
    incrementMoves() {
        this.moves++;
        if (this.moves_number_text) {
            this.moves_number_text.string = this.moves;
        }
    }
 
    updateScore(scoreToAppend: number) {
        this.score += scoreToAppend;
        if (this.score_number_text) {
            this.score_number_text.string = this.score + "/" + this.targetScore;
        }
    }
 
    private async collapseAndFill(spawnAt: { row: number; col: number } | null = null) {
        this.collapseBoard();
        await this.wait(this.ANIM_DURATION * 2); // Wait for collapse + fill tweens (ANIM_DURATION each) to finish
		
        this.fillBoard();
        await this.wait(this.ANIM_DURATION);
 
        if (spawnAt) {
            this.spawnSuperTile(spawnAt.row, spawnAt.col);
        }
    }
 
    ////////////////////////////////////////////////////////////////////
    // Super tile
    //
    spawnSuperTile(row: number, col: number) {
        const existing = this.board[row][col];
        if (existing) {
            existing.node.destroy();
            this.board[row][col] = null;
        }
 
        const types     = [
			SuperTileType.ROW,
			SuperTileType.COLUMN,
			SuperTileType.RADIUS,
			SuperTileType.ALL_FIELD
		];
        const superType = types[Math.floor(Math.random() * types.length)];
 
        const td = this.createTile(row, col, superType);
        td.node.scale = 0;
        cc.tween(td.node).to(0.25, { scale: 1.15 }).to(0.1, { scale: 1 }).start();
 
        cc.log("Super tile spawned at (${row},${col}): ${SuperTileType[superType]}");
    }
 
    async activateSuperTile(tile: TileData) {
        const { row, col, superType } = tile;
 
        this.board[row][col] = null;
        this.animateDestroy(tile.node);
        switch (superType) {
            case SuperTileType.ROW:       { await this.burnRow(row);                          break; }
            case SuperTileType.COLUMN:    { await this.burnColumn(col);                       break; }
            case SuperTileType.RADIUS:    { await this.burnRadius(row, col, this.bombRadius); break; }
            case SuperTileType.ALL_FIELD: { await this.burnAll();                             break; }
        }
    }
 
    ////////////////////////////////////////////////////////////////////
    // Burn helpers
    //
    async burnRow(row: number) {
        const toDestroy: TileData[] = [];
        for (let c = 0; c < this.cols; c++) {
            const t = this.board[row][c];
            if (t) {
				toDestroy.push(t);
			}
        }
        this.destroyTiles(toDestroy);
        cc.log("Burned row ${row}");
    }
 
    async burnColumn(col: number) {
        const toDestroy: TileData[] = [];
        for (let r = 0; r < this.rows; r++) {
            const t = this.board[r][col];
            if (t) toDestroy.push(t);
        }
        this.destroyTiles(toDestroy);
        cc.log("Burned column ${col}");
    }
 
    async burnRadius(centerRow: number, centerCol: number, radius: number) {
        const toDestroy: TileData[] = [];
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (Math.abs(r - centerRow) <= radius && Math.abs(c - centerCol) <= radius) {
                    const t = this.board[r][c];
                    if (t) toDestroy.push(t);
                }
            }
        }
        this.destroyTiles(toDestroy);
        cc.log("Burned radius ${radius} around (${centerRow},${centerCol})");
    }
 
    async burnAll() {
        const toDestroy: TileData[] = [];
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const t = this.board[r][c];
                if (t) toDestroy.push(t);
            }
        }
        this.destroyTiles(toDestroy);
        cc.log("Burned entire field!");
    }
 
    destroyTiles(tiles: TileData[]) {
        for (const t of tiles) {
			this.spawnParticleForTile(t);
			
            this.board[t.row][t.col] = null;
            this.animateDestroy(t.node);
			this.updateScore(10);
        }
    }
 
    ////////////////////////////////////////////////////////////////////
    // Teleport swap
    //
    async swapTiles(a: TileData, b: TileData) {
        this.board[a.row][a.col] = b;
        this.board[b.row][b.col] = a;
 
        const ar = a.row;
		const ac = a.col;
        const br = b.row;
		const bc = b.col;
        a.row    = br;
		a.col    = bc;
        b.row    = ar;
		b.col    = ac;
 
        const ax = (ac - this.cols / 2)      * this.tileSizeX + this.tileSizeX / 2;
        const ay = (     this.rows / 2 - ar) * this.tileSizeY - this.tileSizeY / 2;
        const bx = (bc - this.cols / 2)      * this.tileSizeX + this.tileSizeX / 2;
        const by = (     this.rows / 2 - br) * this.tileSizeY - this.tileSizeY / 2;
 
        cc.tween(a.node).to(0.25, { x: bx, y: by }).start();
        cc.tween(b.node).to(0.25, { x: ax, y: ay }).start();
 
        await this.wait(0.3);
        cc.log("Teleport: swapped (${ar},${ac}) <-> (${br},${bc})");
    }
 
    ////////////////////////////////////////////////////////////////////
    // Shuffle
    //
    async shuffleBoard() {
        this.shuffleCount++;
        cc.log("Shuffling board (attempt ${this.shuffleCount}/${this.MAX_SHUFFLES})...");
 
        const tiles: TileData[] = [];
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (this.board[r][c]) tiles.push(this.board[r][c]);
            }
        }
 
        // Fisher-Yates shuffle
        for (let i = tiles.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
			
			const ni = tiles[i].node, nj = tiles[j].node;
			[tiles[i].color,     tiles[j].color]     = [tiles[j].color,     tiles[i].color];
			[tiles[i].superType, tiles[j].superType] = [tiles[j].superType, tiles[i].superType];
			[tiles[i].node,      tiles[j].node]      = [nj, ni];
        }
 
        for (const t of tiles) {
            const sprite = t.node.getComponent(cc.Sprite);
            if (t.superType !== SuperTileType.NONE) {
                sprite.spriteFrame = this.superTile_sprites.length > t.superType
                    ? this.superTile_sprites[t.superType]
                    : this.colored_sprites[0];
            } else {
                sprite.spriteFrame = this.colored_sprites[t.color];
                t.node.color       = cc.Color.WHITE;
            }
 
            cc.tween(t.node)
                .to(0.1, { opacity: 0 })
                .to(0.1, { opacity: 255 })
                .start();
        }
 
        await this.wait(0.25);
    }
 
	showResultWindow(text: string, second_text: string) {
		this.game_result_window.active           = true;
		this.game_result_text.node.active        = true;
		this.game_result_second_text.node.active = true;
		
		this.game_result_text.string        = text;
		this.game_result_second_text.string = second_text;
	}
 
    ////////////////////////////////////////////////////////////////////
    // End-condition checker
    //
    async checkEndConditions() {
        if (this.score >= this.targetScore) {
            this.showResultWindow("ВЫ ВЫИГРАЛИ!", "");
            return;
        }
        if (this.moves >= this.maxMoves) {
            this.showResultWindow("ВЫ ПРОИГРАЛИ!", "Вы не смогли закончить игру за 20 шагов");
            return;
        }
		
		while (!this.hasPossibleMoves() && this.shuffleCount < this.MAX_SHUFFLES) {
			await this.shuffleBoard();
		}
		if (!this.hasPossibleMoves()) {
			this.showResultWindow("ВЫ ПРОИГРАЛИ!", "Нет ходов после максимального кол-ва шафлов");
		}
    }
 
    ////////////////////////////////////////////////////////////////////
    // Booster activation
    //
	deactivateBooster() {
        if (this.pendingOps > 0) {
			return;
		}
        this.boosterMode    = BoosterMode.NONE;
        this.teleportFirst  = null;
		this.currentBooster = null;
    }
	
    activateBombBooster(booster: Booster) {
        if (this.pendingOps > 0) {
			return;
		}
        this.boosterMode    = BoosterMode.BOMB;
        this.teleportFirst  = null;
		this.currentBooster = booster;
    }
 
    activateTeleportBooster(booster: Booster) {
        if (this.pendingOps > 0) {
			return;
		}
        this.boosterMode    = BoosterMode.TELEPORT;
        this.teleportFirst  = null;
		this.currentBooster = booster;
    }
 
    ////////////////////////////////////////////////////////////////////
    // Core game logic
    //
    findGroup(row: number, col: number, color: number): TileData[] {
        const result:  TileData[]   = [];
        const visited: boolean[][]  = [];
        for (let r = 0; r < this.rows; r++) {
			visited[r] = [];
		}
 
        const dfs = (r: number, c: number) => {
            if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) {
				return;
			}
            if (visited[r][c]) {
				return;
			}
			
            const tile = this.board[r][c];
            if (!tile || tile.color !== color || tile.superType !== SuperTileType.NONE) {
				return;
			}
			
            visited[r][c] = true;
            result.push(tile);
            dfs(r + 1, c);
			dfs(r - 1, c);
            dfs(r, c + 1);
			dfs(r, c - 1);
        };
 
        dfs(row, col);
        return result;
    }
 
    collapseBoard() {
        for (let col = 0; col < this.cols; col++) {
            let emptyRow = this.rows - 1;
            for (let row = this.rows - 1; row >= 0; row--) {
                const tile = this.board[row][col];
                if (tile) {
                    if (row !== emptyRow) {
                        this.board[emptyRow][col] = tile;
                        this.board[row][col]      = null;
                        tile.row                  = emptyRow;
                        tile.node.zIndex          = this.rows - emptyRow;
                        const targetY             = (this.rows / 2 - emptyRow) * this.tileSizeY - this.tileSizeY / 2;
                        cc.tween(tile.node).to(this.ANIM_DURATION, { y: targetY }).start();
                    }
                    emptyRow--;
                }
            }
        }
    }
 
    fillBoard() {
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                if (this.board[row][col]) {
					continue;
				}
 
                const superType   = this.pickTileTypeForSpawn();
                const isSuperTile = superType !== SuperTileType.NONE;
                const node        = cc.instantiate(this.tilePrefab);
                node.parent       = this.node;
 
                const colorIndex = isSuperTile ? -1 : Math.floor(Math.random() * this.colored_sprites.length);
                const startY     = (      this.rows / 2 + 1)   * this.tileSizeY;
                const targetY    = (      this.rows / 2 - row) * this.tileSizeY - this.tileSizeY / 2;
                const x          = (col - this.cols / 2)       * this.tileSizeX + this.tileSizeX / 2;
 
                node.setPosition(x, startY);
                node.zIndex = this.rows - row;
 
                const sprite = node.getComponent(cc.Sprite);
                if (isSuperTile) {
                    sprite.spriteFrame = this.superTile_sprites.length > superType
                        ? this.superTile_sprites[superType]
                        : this.colored_sprites[0];
                } else {
                    sprite.spriteFrame = this.colored_sprites[colorIndex];
                }
 
                const tileData: TileData = { row, col, color: colorIndex, node, superType };
                this.board[row][col] = tileData;
 
                node.on(cc.Node.EventType.TOUCH_END, () => this.onTileClick(tileData));
                cc.tween(node).to(this.ANIM_DURATION, { y: targetY }).start();
            }
        }
    }
 
    hasPossibleMoves(): boolean {
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const tile = this.board[r][c];
                if (!tile) {
					continue;
				}
                if (tile.superType !== SuperTileType.NONE) {
					return true;
				}
                if (this.findGroup(r, c, tile.color).length > 1) {
					return true;
				}
			}
        }
        return false;
    }
 
    ////////////////////////////////////////////////////////////////////
    // Utilities
    //
    private animateDestroy(node: cc.Node) {
        cc.tween(node)
            .to(0.15, { scale: 0, opacity: 0 })
            .call(() => node.destroy())
            .start();
    }
 
    private highlightNode(node: cc.Node, on: boolean) {
        node.color = on ? new cc.Color(255, 255, 100) : cc.Color.WHITE;
    }
 
    private wait(seconds: number): Promise<void> {
        return new Promise(resolve => this.scheduleOnce(() => resolve(), seconds));
    }
}