import { expect } from "chai";
import hre from "hardhat";

// Hardhat 3 pattern: create a network connection at module level
const { ethers, networkHelpers } = await hre.network.create();

// ─── Helpers ───────────────────────────────────────────────────────────────
const Category = { AI_GENERATED: 0n, AI_ASSISTED: 1n, HUMAN_CREATED: 2n } as const;
const Status = { Active: 0n, Disputed: 1n, Revoked: 2n } as const;

/** A random-ish bytes32 that is non-zero */
function fakeHash(n: number): string {
  return ethers.zeroPadBytes(ethers.toBeHex(n), 32);
}

async function deployFixture() {
  const [owner, alice, bob] = await ethers.getSigners();
  const Registry = await ethers.getContractFactory("VerifyAIRegistry");
  const registry = await Registry.deploy(owner.address);
  return { registry, owner, alice, bob };
}

// ─────────────────────────────────────────────────────────────────────────────
describe("VerifyAIRegistry", function () {
  // ── Deployment ──────────────────────────────────────────────────────────
  describe("Deployment", function () {
    it("seeds 6 models that are all active", async function () {
      const { registry } = await deployFixture();
      const names = await registry.getModelNames();
      expect(names).to.deep.equal(["GPT", "Gemini", "Claude", "Stable Diffusion", "Midjourney", "Other"]);
      for (const name of names) {
        expect(await registry.isModelActive(name)).to.equal(true);
      }
    });

    it("starts with zero records and zero counts", async function () {
      const { registry } = await deployFixture();
      const stats = await registry.getStats();
      expect(stats.total).to.equal(0n);
      expect(stats.aiGenerated).to.equal(0n);
      expect(stats.aiAssisted).to.equal(0n);
      expect(stats.humanCreated).to.equal(0n);
      expect(stats.active).to.equal(0n);
    });
  });

  // ── Successful register ─────────────────────────────────────────────────
  describe("register – success cases", function () {
    it("registers an AI_GENERATED record with correct fields", async function () {
      const { registry, alice } = await deployFixture();
      const hash = fakeHash(1);

      await registry.connect(alice).register(
        hash, "My AI art", Category.AI_GENERATED, "GPT", "4o",
        ethers.ZeroHash, ethers.ZeroHash
      );

      const rec = await registry.getRecord(hash);
      expect(rec.creator).to.equal(alice.address);
      expect(rec.category).to.equal(Category.AI_GENERATED);
      expect(rec.status).to.equal(Status.Active);
      expect(rec.title).to.equal("My AI art");
      expect(rec.model).to.equal("GPT");
      expect(rec.modelVersion).to.equal("4o");
      expect(rec.parentHash).to.equal(ethers.ZeroHash);
      expect(rec.timestamp).to.be.gt(0n);
    });

    it("registers an AI_ASSISTED record with correct fields", async function () {
      const { registry, alice } = await deployFixture();
      const hash = fakeHash(2);

      await registry.connect(alice).register(
        hash, "Assisted work", Category.AI_ASSISTED, "Claude", "3.5",
        ethers.ZeroHash, ethers.ZeroHash
      );

      const rec = await registry.getRecord(hash);
      expect(rec.category).to.equal(Category.AI_ASSISTED);
      expect(rec.status).to.equal(Status.Active);
      expect(rec.model).to.equal("Claude");
    });

    it("registers a HUMAN_CREATED record with correct fields", async function () {
      const { registry, alice } = await deployFixture();
      const hash = fakeHash(3);

      await registry.connect(alice).register(
        hash, "Human poem", Category.HUMAN_CREATED, "", "",
        ethers.ZeroHash, ethers.ZeroHash
      );

      const rec = await registry.getRecord(hash);
      expect(rec.category).to.equal(Category.HUMAN_CREATED);
      expect(rec.status).to.equal(Status.Active);
      expect(rec.model).to.equal("");
    });

    it("increments all counters after registration", async function () {
      const { registry, alice } = await deployFixture();

      await registry.connect(alice).register(fakeHash(1), "A", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash);
      await registry.connect(alice).register(fakeHash(2), "B", Category.AI_ASSISTED, "Claude", "1", ethers.ZeroHash, ethers.ZeroHash);
      await registry.connect(alice).register(fakeHash(3), "C", Category.HUMAN_CREATED, "", "", ethers.ZeroHash, ethers.ZeroHash);

      const stats = await registry.getStats();
      expect(stats.total).to.equal(3n);
      expect(stats.aiGenerated).to.equal(1n);
      expect(stats.aiAssisted).to.equal(1n);
      expect(stats.humanCreated).to.equal(1n);
      expect(stats.active).to.equal(3n);
    });

    it("adds to creator record list", async function () {
      const { registry, alice } = await deployFixture();
      const h1 = fakeHash(1);
      const h2 = fakeHash(2);

      await registry.connect(alice).register(h1, "A", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash);
      await registry.connect(alice).register(h2, "B", Category.HUMAN_CREATED, "", "", ethers.ZeroHash, ethers.ZeroHash);

      const recs = await registry.getCreatorRecords(alice.address);
      expect(recs.length).to.equal(2);
      expect(recs).to.include(h1);
      expect(recs).to.include(h2);
    });

    it("increments modelUses for AI categories", async function () {
      const { registry, alice } = await deployFixture();

      await registry.connect(alice).register(fakeHash(1), "A", Category.AI_GENERATED, "GPT", "4", ethers.ZeroHash, ethers.ZeroHash);
      await registry.connect(alice).register(fakeHash(2), "B", Category.AI_ASSISTED, "GPT", "4", ethers.ZeroHash, ethers.ZeroHash);

      expect(await registry.modelUses("GPT")).to.equal(2n);
    });

    it("does NOT increment modelUses for HUMAN_CREATED", async function () {
      const { registry, alice } = await deployFixture();

      await registry.connect(alice).register(fakeHash(1), "A", Category.HUMAN_CREATED, "", "", ethers.ZeroHash, ethers.ZeroHash);

      // no model was used
      expect(await registry.modelUses("GPT")).to.equal(0n);
    });
  });

  // ── register – revert cases ─────────────────────────────────────────────
  describe("register – revert cases", function () {
    it("reverts with ZeroHash when fileHash is zero", async function () {
      const { registry, alice } = await deployFixture();
      await expect(
        registry.connect(alice).register(ethers.ZeroHash, "Title", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(registry, "ZeroHash");
    });

    it("reverts with AlreadyRegistered for duplicate hash", async function () {
      const { registry, alice } = await deployFixture();
      const hash = fakeHash(1);
      await registry.connect(alice).register(hash, "A", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash);
      await expect(
        registry.connect(alice).register(hash, "B", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(registry, "AlreadyRegistered");
    });

    it("reverts with EmptyTitle when title is empty", async function () {
      const { registry, alice } = await deployFixture();
      await expect(
        registry.connect(alice).register(fakeHash(1), "", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(registry, "EmptyTitle");
    });

    it("reverts with TitleTooLong when title > 80 bytes", async function () {
      const { registry, alice } = await deployFixture();
      const longTitle = "A".repeat(81);
      await expect(
        registry.connect(alice).register(fakeHash(1), longTitle, Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(registry, "TitleTooLong");
    });

    it("accepts a title of exactly 80 bytes", async function () {
      const { registry, alice } = await deployFixture();
      const title80 = "A".repeat(80);
      await expect(
        registry.connect(alice).register(fakeHash(1), title80, Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash)
      ).to.not.revert(ethers);
    });

    it("reverts with HumanCreatedMustHaveNoModel for HUMAN_CREATED with model", async function () {
      const { registry, alice } = await deployFixture();
      await expect(
        registry.connect(alice).register(fakeHash(1), "Art", Category.HUMAN_CREATED, "GPT", "", ethers.ZeroHash, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(registry, "HumanCreatedMustHaveNoModel");
    });

    it("reverts with AIRecordMustHaveModel for AI_GENERATED with no model", async function () {
      const { registry, alice } = await deployFixture();
      await expect(
        registry.connect(alice).register(fakeHash(1), "Art", Category.AI_GENERATED, "", "", ethers.ZeroHash, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(registry, "AIRecordMustHaveModel");
    });

    it("reverts with AIRecordMustHaveModel for AI_ASSISTED with no model", async function () {
      const { registry, alice } = await deployFixture();
      await expect(
        registry.connect(alice).register(fakeHash(1), "Art", Category.AI_ASSISTED, "", "", ethers.ZeroHash, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(registry, "AIRecordMustHaveModel");
    });

    it("reverts with ModelNotActive for an inactive model", async function () {
      const { registry, owner, alice } = await deployFixture();
      await registry.connect(owner).deactivateModel("GPT");
      await expect(
        registry.connect(alice).register(fakeHash(1), "Art", Category.AI_GENERATED, "GPT", "4", ethers.ZeroHash, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(registry, "ModelNotActive");
    });

    it("reverts with ModelNotActive for an unknown model name", async function () {
      const { registry, alice } = await deployFixture();
      await expect(
        registry.connect(alice).register(fakeHash(1), "Art", Category.AI_GENERATED, "UnknownModel", "1", ethers.ZeroHash, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(registry, "ModelNotActive");
    });

    it("reverts with InvalidParent when parent hash does not exist", async function () {
      const { registry, alice } = await deployFixture();
      await expect(
        registry.connect(alice).register(fakeHash(2), "Edit", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, fakeHash(99))
      ).to.be.revertedWithCustomError(registry, "InvalidParent");
    });

    it("reverts with NotParentCreator when a different wallet tries to edit", async function () {
      const { registry, alice, bob } = await deployFixture();
      const parentHash = fakeHash(1);
      await registry.connect(alice).register(parentHash, "Original", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash);
      await expect(
        registry.connect(bob).register(fakeHash(2), "Edit", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, parentHash)
      ).to.be.revertedWithCustomError(registry, "NotParentCreator");
    });

    it("reverts with ParentRevoked when parent is Revoked", async function () {
      const { registry, owner, alice } = await deployFixture();
      const parentHash = fakeHash(1);
      await registry.connect(alice).register(parentHash, "Original", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash);
      await registry.connect(owner).setStatus(parentHash, Status.Revoked);
      await expect(
        registry.connect(alice).register(fakeHash(2), "Edit", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, parentHash)
      ).to.be.revertedWithCustomError(registry, "ParentRevoked");
    });
  });

  // ── Edit chain ──────────────────────────────────────────────────────────
  describe("Edit chain", function () {
    it("builds a 3-level chain and getChildren is correct", async function () {
      const { registry, alice } = await deployFixture();
      const h0 = fakeHash(10);
      const h1 = fakeHash(11);
      const h2 = fakeHash(12);

      await registry.connect(alice).register(h0, "Original", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash);
      await registry.connect(alice).register(h1, "Edit 1", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, h0);
      await registry.connect(alice).register(h2, "Edit 2", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, h1);

      const ch0 = await registry.getChildren(h0);
      expect(ch0.length).to.equal(1);
      expect(ch0[0]).to.equal(h1);

      const ch1 = await registry.getChildren(h1);
      expect(ch1.length).to.equal(1);
      expect(ch1[0]).to.equal(h2);

      expect((await registry.getChildren(h2)).length).to.equal(0);
    });
  });

  // ── Report flow ─────────────────────────────────────────────────────────
  describe("reportRecord", function () {
    it("files a valid report and event is emitted", async function () {
      const { registry, alice, bob } = await deployFixture();
      const hash = fakeHash(1);
      await registry.connect(alice).register(hash, "A", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash);

      await expect(registry.connect(bob).reportRecord(hash, "Suspicious content"))
        .to.emit(registry, "ReportFiled")
        .withArgs(0n, hash, bob.address);

      const report = await registry.getReport(0);
      expect(report.fileHash).to.equal(hash);
      expect(report.reporter).to.equal(bob.address);
      expect(report.reason).to.equal("Suspicious content");
      expect(report.resolved).to.equal(false);
    });

    it("reverts with EmptyReason for empty reason", async function () {
      const { registry, alice, bob } = await deployFixture();
      const hash = fakeHash(1);
      await registry.connect(alice).register(hash, "A", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash);
      await expect(
        registry.connect(bob).reportRecord(hash, "")
      ).to.be.revertedWithCustomError(registry, "EmptyReason");
    });

    it("reverts with ReasonTooLong for a 281-byte reason", async function () {
      const { registry, alice, bob } = await deployFixture();
      const hash = fakeHash(1);
      await registry.connect(alice).register(hash, "A", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash);
      const longReason = "x".repeat(281);
      await expect(
        registry.connect(bob).reportRecord(hash, longReason)
      ).to.be.revertedWithCustomError(registry, "ReasonTooLong");
    });

    it("accepts a reason of exactly 280 bytes", async function () {
      const { registry, alice, bob } = await deployFixture();
      const hash = fakeHash(1);
      await registry.connect(alice).register(hash, "A", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash);
      await expect(
        registry.connect(bob).reportRecord(hash, "x".repeat(280))
      ).to.not.revert(ethers);
    });

    it("reverts with RecordNotFound for non-existent record", async function () {
      const { registry, bob } = await deployFixture();
      await expect(
        registry.connect(bob).reportRecord(fakeHash(99), "Bad")
      ).to.be.revertedWithCustomError(registry, "RecordNotFound");
    });
  });

  // ── setStatus ───────────────────────────────────────────────────────────
  describe("setStatus", function () {
    it("owner can change status and event is emitted", async function () {
      const { registry, owner, alice } = await deployFixture();
      const hash = fakeHash(1);
      await registry.connect(alice).register(hash, "A", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash);

      await expect(registry.connect(owner).setStatus(hash, Status.Disputed))
        .to.emit(registry, "StatusChanged")
        .withArgs(hash, Status.Active, Status.Disputed);

      const rec = await registry.getRecord(hash);
      expect(rec.status).to.equal(Status.Disputed);
    });

    it("non-owner cannot call setStatus", async function () {
      const { registry, alice } = await deployFixture();
      const hash = fakeHash(1);
      await registry.connect(alice).register(hash, "A", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash);
      await expect(
        registry.connect(alice).setStatus(hash, Status.Revoked)
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("status counters stay correct after status change", async function () {
      const { registry, owner, alice } = await deployFixture();
      const hash = fakeHash(1);
      await registry.connect(alice).register(hash, "A", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash);

      // Active -> Disputed
      await registry.connect(owner).setStatus(hash, Status.Disputed);
      let stats = await registry.getStats();
      expect(stats.active).to.equal(0n);
      expect(stats.disputed).to.equal(1n);

      // Disputed -> Revoked
      await registry.connect(owner).setStatus(hash, Status.Revoked);
      stats = await registry.getStats();
      expect(stats.disputed).to.equal(0n);
      expect(stats.revoked).to.equal(1n);

      // Revoked -> Active
      await registry.connect(owner).setStatus(hash, Status.Active);
      stats = await registry.getStats();
      expect(stats.revoked).to.equal(0n);
      expect(stats.active).to.equal(1n);
    });

    it("admin cannot alter creator data via setStatus", async function () {
      const { registry, owner, alice } = await deployFixture();
      const hash = fakeHash(1);
      await registry.connect(alice).register(hash, "A", Category.AI_GENERATED, "GPT", "4", ethers.ZeroHash, ethers.ZeroHash);
      await registry.connect(owner).setStatus(hash, Status.Revoked);

      const rec = await registry.getRecord(hash);
      // Creator data unchanged
      expect(rec.creator).to.equal(alice.address);
      expect(rec.title).to.equal("A");
      expect(rec.model).to.equal("GPT");
    });

    it("reverts with RecordNotFound for non-existent record", async function () {
      const { registry, owner } = await deployFixture();
      await expect(
        registry.connect(owner).setStatus(fakeHash(99), Status.Disputed)
      ).to.be.revertedWithCustomError(registry, "RecordNotFound");
    });
  });

  // ── Ownership (Ownable2Step) ─────────────────────────────────────────────
  describe("Ownership", function () {
    it("renounceOwnership always reverts with RenounceDisabled", async function () {
      const { registry, owner } = await deployFixture();
      await expect(
        registry.connect(owner).renounceOwnership()
      ).to.be.revertedWithCustomError(registry, "RenounceDisabled");
    });

    it("transferOwnership only sets pendingOwner; old owner remains admin until accepted", async function () {
      const { registry, owner, alice } = await deployFixture();
      const hash = fakeHash(1);
      await registry.connect(alice).register(hash, "A", Category.HUMAN_CREATED, "", "", ethers.ZeroHash, ethers.ZeroHash);

      await registry.connect(owner).transferOwnership(alice.address);
      expect(await registry.pendingOwner()).to.equal(alice.address);
      expect(await registry.owner()).to.equal(owner.address);

      // Old owner is STILL admin
      await registry.connect(owner).setStatus(hash, Status.Disputed);
      expect((await registry.getRecord(hash)).status).to.equal(Status.Disputed);

      // Alice cannot call admin functions yet
      await expect(
        registry.connect(alice).setStatus(hash, Status.Active)
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("non-pending owner cannot call acceptOwnership", async function () {
      const { registry, owner, alice, bob } = await deployFixture();
      await registry.connect(owner).transferOwnership(alice.address);

      await expect(
        registry.connect(bob).acceptOwnership()
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("after acceptOwnership: new owner can setStatus, old owner cannot", async function () {
      const { registry, owner, alice } = await deployFixture();
      const hash = fakeHash(1);
      await registry.connect(alice).register(hash, "A", Category.HUMAN_CREATED, "", "", ethers.ZeroHash, ethers.ZeroHash);

      await registry.connect(owner).transferOwnership(alice.address);
      await registry.connect(alice).acceptOwnership();
      expect(await registry.owner()).to.equal(alice.address);
      expect(await registry.pendingOwner()).to.equal(ethers.ZeroAddress);

      // New owner succeeds
      await registry.connect(alice).setStatus(hash, Status.Disputed);
      expect((await registry.getRecord(hash)).status).to.equal(Status.Disputed);

      // Old owner fails
      await expect(
        registry.connect(owner).setStatus(hash, Status.Active)
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });
  });

  // ── resolveReport ───────────────────────────────────────────────────────
  describe("resolveReport", function () {
    it("owner can resolve a report and event is emitted", async function () {
      const { registry, owner, alice, bob } = await deployFixture();
      const hash = fakeHash(1);
      await registry.connect(alice).register(hash, "A", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash);
      await registry.connect(bob).reportRecord(hash, "Bad");

      await expect(registry.connect(owner).resolveReport(0))
        .to.emit(registry, "ReportResolved")
        .withArgs(0n);

      const report = await registry.getReport(0);
      expect(report.resolved).to.equal(true);
    });

    it("non-owner cannot resolve a report", async function () {
      const { registry, alice, bob } = await deployFixture();
      const hash = fakeHash(1);
      await registry.connect(alice).register(hash, "A", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash);
      await registry.connect(bob).reportRecord(hash, "Bad");
      await expect(
        registry.connect(alice).resolveReport(0)
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("reverts with ReportNotFound for invalid ID", async function () {
      const { registry, owner } = await deployFixture();
      await expect(
        registry.connect(owner).resolveReport(999)
      ).to.be.revertedWithCustomError(registry, "ReportNotFound");
    });

    it("reverts with ReportAlreadyResolved when resolving twice", async function () {
      const { registry, owner, alice, bob } = await deployFixture();
      const hash = fakeHash(1);
      await registry.connect(alice).register(hash, "A", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash);
      await registry.connect(bob).reportRecord(hash, "Bad");
      await registry.connect(owner).resolveReport(0);
      await expect(
        registry.connect(owner).resolveReport(0)
      ).to.be.revertedWithCustomError(registry, "ReportAlreadyResolved");
    });
  });

  // ── addModel / deactivateModel ──────────────────────────────────────────
  describe("Model management", function () {
    it("owner can add a new model", async function () {
      const { registry, owner } = await deployFixture();
      await expect(registry.connect(owner).addModel("LlamaX"))
        .to.emit(registry, "ModelAdded")
        .withArgs("LlamaX");
      expect(await registry.isModelActive("LlamaX")).to.equal(true);
    });

    it("non-owner cannot add a model", async function () {
      const { registry, alice } = await deployFixture();
      await expect(
        registry.connect(alice).addModel("LlamaX")
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("owner can deactivate a model", async function () {
      const { registry, owner } = await deployFixture();
      await expect(registry.connect(owner).deactivateModel("GPT"))
        .to.emit(registry, "ModelDeactivated")
        .withArgs("GPT");
      expect(await registry.isModelActive("GPT")).to.equal(false);
    });

    it("non-owner cannot deactivate a model", async function () {
      const { registry, alice } = await deployFixture();
      await expect(
        registry.connect(alice).deactivateModel("GPT")
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("deactivated model blocks new AI registrations", async function () {
      const { registry, owner, alice } = await deployFixture();
      await registry.connect(owner).deactivateModel("GPT");
      await expect(
        registry.connect(alice).register(fakeHash(1), "Art", Category.AI_GENERATED, "GPT", "4", ethers.ZeroHash, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(registry, "ModelNotActive");
    });

    it("reactivating an inactive model works and does not duplicate it in the list", async function () {
      const { registry, owner, alice } = await deployFixture();
      await registry.connect(owner).deactivateModel("GPT");
      expect(await registry.isModelActive("GPT")).to.equal(false);

      await registry.connect(owner).addModel("GPT"); // reactivate
      expect(await registry.isModelActive("GPT")).to.equal(true);

      // Should still be only 6 models (no duplicate)
      const names = await registry.getModelNames();
      expect(names.filter((n: string) => n === "GPT").length).to.equal(1);
    });

    it("modelUses increments correctly", async function () {
      const { registry, alice } = await deployFixture();

      expect(await registry.modelUses("Gemini")).to.equal(0n);

      await registry.connect(alice).register(fakeHash(1), "A", Category.AI_GENERATED, "Gemini", "2", ethers.ZeroHash, ethers.ZeroHash);
      expect(await registry.modelUses("Gemini")).to.equal(1n);

      await registry.connect(alice).register(fakeHash(2), "B", Category.AI_ASSISTED, "Gemini", "2", ethers.ZeroHash, ethers.ZeroHash);
      expect(await registry.modelUses("Gemini")).to.equal(2n);
    });

    it("reverts ModelAlreadyActive when adding an already-active model", async function () {
      const { registry, owner } = await deployFixture();
      await expect(
        registry.connect(owner).addModel("GPT")
      ).to.be.revertedWithCustomError(registry, "ModelAlreadyActive");
    });

    it("deactivateModel on unknown model reverts ModelNotFound", async function () {
      const { registry, owner } = await deployFixture();
      await expect(
        registry.connect(owner).deactivateModel("NonExistentXYZ")
      ).to.be.revertedWithCustomError(registry, "ModelNotFound");
    });

    it("deactivateModel on already-inactive model reverts ModelAlreadyInactive", async function () {
      const { registry, owner } = await deployFixture();
      await registry.connect(owner).deactivateModel("GPT");
      await expect(
        registry.connect(owner).deactivateModel("GPT")
      ).to.be.revertedWithCustomError(registry, "ModelAlreadyInactive");
    });
  });

  // ── Events ──────────────────────────────────────────────────────────────
  describe("Events", function () {
    it("emits Registered with correct args", async function () {
      const { registry, alice } = await deployFixture();
      const hash = fakeHash(1);
      await expect(
        registry.connect(alice).register(hash, "A", Category.AI_GENERATED, "GPT", "4", ethers.ZeroHash, ethers.ZeroHash)
      )
        .to.emit(registry, "Registered")
        .withArgs(hash, alice.address, Category.AI_GENERATED, "GPT");
    });

    it("emits StatusChanged with correct args", async function () {
      const { registry, owner, alice } = await deployFixture();
      const hash = fakeHash(1);
      await registry.connect(alice).register(hash, "A", Category.AI_GENERATED, "GPT", "4", ethers.ZeroHash, ethers.ZeroHash);
      await expect(registry.connect(owner).setStatus(hash, Status.Revoked))
        .to.emit(registry, "StatusChanged")
        .withArgs(hash, Status.Active, Status.Revoked);
    });

    it("emits ModelAdded with correct args", async function () {
      const { registry, owner } = await deployFixture();
      await expect(registry.connect(owner).addModel("NewBot"))
        .to.emit(registry, "ModelAdded")
        .withArgs("NewBot");
    });

    it("emits ModelDeactivated with correct args", async function () {
      const { registry, owner } = await deployFixture();
      await expect(registry.connect(owner).deactivateModel("Claude"))
        .to.emit(registry, "ModelDeactivated")
        .withArgs("Claude");
    });
  });

  // ── exists / getRecord view functions ───────────────────────────────────
  describe("View functions", function () {
    it("exists returns false for non-existent hash", async function () {
      const { registry } = await deployFixture();
      expect(await registry.exists(fakeHash(999))).to.equal(false);
    });

    it("exists returns true after registration", async function () {
      const { registry, alice } = await deployFixture();
      const hash = fakeHash(1);
      await registry.connect(alice).register(hash, "A", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash);
      expect(await registry.exists(hash)).to.equal(true);
    });

    it("getRecord reverts with RecordNotFound for non-existent hash", async function () {
      const { registry } = await deployFixture();
      await expect(
        registry.getRecord(fakeHash(999))
      ).to.be.revertedWithCustomError(registry, "RecordNotFound");
    });

    it("reportCount returns correct count", async function () {
      const { registry, alice, bob } = await deployFixture();
      const hash = fakeHash(1);
      await registry.connect(alice).register(hash, "A", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash);
      await registry.connect(bob).reportRecord(hash, "r1");
      await registry.connect(bob).reportRecord(hash, "r2");
      expect(await registry.reportCount()).to.equal(2n);
    });
  });

  // ── Extra Tests ─────────────────────────────────────────────────────────
  describe("Extra Tests", function () {
    it("edit can have a different category than its parent", async function () {
      const { registry, alice } = await deployFixture();
      const parentHash = fakeHash(10);
      const editHash = fakeHash(11);
      
      await registry.connect(alice).register(parentHash, "Human", Category.HUMAN_CREATED, "", "", ethers.ZeroHash, ethers.ZeroHash);
      await registry.connect(alice).register(editHash, "Edit", Category.AI_ASSISTED, "Claude", "3", ethers.ZeroHash, parentHash);
      
      const rec = await registry.getRecord(editHash);
      expect(rec.category).to.equal(Category.AI_ASSISTED);
      expect(rec.parentHash).to.equal(parentHash);
    });

    it("getCreatorRecords includes originals and edits in registration order", async function () {
      const { registry, alice } = await deployFixture();
      const h0 = fakeHash(20);
      const h1 = fakeHash(21);
      const h2 = fakeHash(22);

      await registry.connect(alice).register(h0, "A", Category.HUMAN_CREATED, "", "", ethers.ZeroHash, ethers.ZeroHash);
      await registry.connect(alice).register(h1, "B", Category.HUMAN_CREATED, "", "", ethers.ZeroHash, h0);
      await registry.connect(alice).register(h2, "C", Category.HUMAN_CREATED, "", "", ethers.ZeroHash, ethers.ZeroHash);

      const recs = await registry.getCreatorRecords(alice.address);
      expect(recs).to.deep.equal([h0, h1, h2]);
    });

    it("setStatus to the same value causes no counter change and no event", async function () {
      const { registry, owner, alice } = await deployFixture();
      const hash = fakeHash(30);
      await registry.connect(alice).register(hash, "A", Category.HUMAN_CREATED, "", "", ethers.ZeroHash, ethers.ZeroHash);

      const statsBefore = await registry.getStats();
      
      await expect(
        registry.connect(owner).setStatus(hash, Status.Active)
      ).to.not.emit(registry, "StatusChanged");

      const statsAfter = await registry.getStats();
      expect(statsAfter.active).to.equal(statsBefore.active);
      expect(statsAfter.disputed).to.equal(statsBefore.disputed);
    });

    it("getStats returns correct numbers after mixed registrations and status changes", async function () {
      const { registry, owner, alice } = await deployFixture();
      const h1 = fakeHash(41);
      const h2 = fakeHash(42);
      const h3 = fakeHash(43);

      await registry.connect(alice).register(h1, "A", Category.AI_GENERATED, "GPT", "4", ethers.ZeroHash, ethers.ZeroHash);
      await registry.connect(alice).register(h2, "B", Category.AI_GENERATED, "GPT", "4", ethers.ZeroHash, ethers.ZeroHash);
      await registry.connect(alice).register(h3, "C", Category.HUMAN_CREATED, "", "", ethers.ZeroHash, ethers.ZeroHash);

      await registry.connect(owner).setStatus(h1, Status.Disputed);
      await registry.connect(owner).setStatus(h2, Status.Revoked);

      const stats = await registry.getStats();
      expect(stats.total).to.equal(3n);
      expect(stats.aiGenerated).to.equal(2n);
      expect(stats.humanCreated).to.equal(1n);
      expect(stats.active).to.equal(1n);
      expect(stats.disputed).to.equal(1n);
      expect(stats.revoked).to.equal(1n);
    });
  });

  // ── Batch Getters ────────────────────────────────────────────────────────
  describe("Batch Getters", function () {
    it("getRecords returns records in the same order as the input", async function () {
      const { registry, alice } = await deployFixture();
      const h1 = fakeHash(101);
      const h2 = fakeHash(102);
      const h3 = fakeHash(103);

      await registry.connect(alice).register(h1, "Rec 1", Category.AI_GENERATED, "GPT", "1", ethers.ZeroHash, ethers.ZeroHash);
      await registry.connect(alice).register(h2, "Rec 2", Category.HUMAN_CREATED, "", "", ethers.ZeroHash, ethers.ZeroHash);
      await registry.connect(alice).register(h3, "Rec 3", Category.AI_ASSISTED, "Claude", "3", ethers.ZeroHash, ethers.ZeroHash);

      const records = await registry.getRecords([h2, h3, h1]);
      expect(records.length).to.equal(3);
      expect(records[0].title).to.equal("Rec 2");
      expect(records[0].category).to.equal(Category.HUMAN_CREATED);
      expect(records[1].title).to.equal("Rec 3");
      expect(records[1].category).to.equal(Category.AI_ASSISTED);
      expect(records[2].title).to.equal("Rec 1");
      expect(records[2].category).to.equal(Category.AI_GENERATED);
    });

    it("getRecords reverts for a missing hash", async function () {
      const { registry, alice } = await deployFixture();
      const h1 = fakeHash(101);
      const missing = fakeHash(999);

      await registry.connect(alice).register(h1, "Rec 1", Category.HUMAN_CREATED, "", "", ethers.ZeroHash, ethers.ZeroHash);

      await expect(
        registry.getRecords([h1, missing])
      ).to.be.revertedWithCustomError(registry, "RecordNotFound").withArgs(missing);
    });

    it("getRecords reverts for 51 hashes with BatchTooLarge", async function () {
      const { registry } = await deployFixture();
      const hashes = Array.from({ length: 51 }, (_, i) => fakeHash(i + 1));

      await expect(
        registry.getRecords(hashes)
      ).to.be.revertedWithCustomError(registry, "BatchTooLarge").withArgs(51n);
    });

    it("getReports returns the correct page", async function () {
      const { registry, alice, bob } = await deployFixture();
      const h = fakeHash(1);
      await registry.connect(alice).register(h, "Rec", Category.HUMAN_CREATED, "", "", ethers.ZeroHash, ethers.ZeroHash);

      for (let i = 0; i < 5; i++) {
        await registry.connect(bob).reportRecord(h, `Reason ${i}`);
      }

      // Fetch page: start = 1, count = 3 -> reports 1, 2, 3
      const page = await registry.getReports(1, 3);
      expect(page.length).to.equal(3);
      expect(page[0].reason).to.equal("Reason 1");
      expect(page[1].reason).to.equal("Reason 2");
      expect(page[2].reason).to.equal("Reason 3");
    });

    it("getReports with start beyond the end returns an empty array", async function () {
      const { registry, alice, bob } = await deployFixture();
      const h = fakeHash(1);
      await registry.connect(alice).register(h, "Rec", Category.HUMAN_CREATED, "", "", ethers.ZeroHash, ethers.ZeroHash);
      await registry.connect(bob).reportRecord(h, "Reason 0");

      const empty = await registry.getReports(10, 5);
      expect(empty).to.deep.equal([]);
    });

    it("getReports clamps correctly when count goes past the end", async function () {
      const { registry, alice, bob } = await deployFixture();
      const h = fakeHash(1);
      await registry.connect(alice).register(h, "Rec", Category.HUMAN_CREATED, "", "", ethers.ZeroHash, ethers.ZeroHash);

      for (let i = 0; i < 3; i++) {
        await registry.connect(bob).reportRecord(h, `Reason ${i}`);
      }

      // 3 total reports. Start at 1, request 10. Should return reports 1 and 2 (length 2).
      const clamped = await registry.getReports(1, 10);
      expect(clamped.length).to.equal(2);
      expect(clamped[0].reason).to.equal("Reason 1");
      expect(clamped[1].reason).to.equal("Reason 2");
    });

    it("getReports reverts for count > 50 with BatchTooLarge", async function () {
      const { registry } = await deployFixture();
      await expect(
        registry.getReports(0, 51)
      ).to.be.revertedWithCustomError(registry, "BatchTooLarge").withArgs(51n);
    });
  });
});
