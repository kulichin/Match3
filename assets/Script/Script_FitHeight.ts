cc.Class({
    extends: cc.Component,
    editor: {
        executeInEditMode: true,
    },

    onLoad() {
        const canvas = cc.find("Canvas");
        const h = canvas.height;
        const sprite = this.node.getComponent(cc.Sprite);
        const orig = sprite.spriteFrame.getOriginalSize();
        const aspect = orig.width / orig.height;
        this.node.height = h;
        this.node.width = h * aspect;
    }
});